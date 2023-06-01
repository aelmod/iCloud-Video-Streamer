import got from 'got';
import stream from 'stream';
import util from 'util';
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import {v4 as uuidv4} from 'uuid';
import {getRange, getFileId, isEmpty, getStreamOptions, isValidHttpUrl} from './util.js'
import 'dotenv/config'
import * as Logger from './logger.js';
import {pathToRegexp} from 'path-to-regexp';

const ICLOUD_API = `https://ckdatabasews.icloud.com/database/1/com.apple.cloudkit/production/public/records/resolve?ckjsBuildVersion=2316ProjectDev28&ckjsVersion=2.6.4&clientId=${uuidv4()}&clientBuildNumber=2316Hotfix20&clientMasteringNumber=2316Hotfix20`;

const pipeline = util.promisify(stream.pipeline);

const app = express()
const port = 3000
const host = process.env.HOST

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(bodyParser.raw());

const tokenPrefix = process.env.TOKEN_PREFIX
const token = process.env.TOKEN
const verifyToken = (req, res, next) => {
    if (req.headers && req.headers.authorization && req.headers.authorization.substring(0, tokenPrefix.length) === tokenPrefix) {
        if (req.headers.authorization === tokenPrefix + token)
            next();
        else {
            Logger.error(`Unauthorized: ${req.headers['x-forwarded-for'] || req.socket.remoteAddress} - ${req.originalUrl}`);
            res.status(401).send({err: 'Unauthorized'});
        }
    } else {
        Logger.error(`Unauthorized: ${req.headers['x-forwarded-for'] || req.socket.remoteAddress} - ${req.originalUrl}`);
        res.status(401).send({err: 'Unauthorized'});
    }
}

const unless = (middleware, method, path, enabled) => (req, res, next) => {
    if (enabled)
        return pathToRegexp(path).exec(req.url) && req.method === method ? next() : middleware(req, res, next)
    return next()
};

app.use(unless(verifyToken, 'GET', '/api/stream/:fileId/:fileName', false /*TODO: move to env*/));

const iCloudUrlToShortcut = new Map;

app.post('/api/stream', (req, response) => {
    const iCloudUrl = req.body.url;
    if (isEmpty(iCloudUrl) || !isValidHttpUrl(iCloudUrl)) {
        response.status(400).send({err: 'URL is not valid'});
        Logger.error(`URL is not valid: ${iCloudUrl}`);
        return
    }

    return axios.post(ICLOUD_API, {
        "shortGUIDs": [{"value": getFileId(iCloudUrl)}]
    })
        .then(res => {
            const serverErrorCode = res.data['results'][0]['serverErrorCode'];
            if (res.status === 200 && isEmpty(serverErrorCode)) {
                const fileName = res.data['results'][0]['share']['fields']['cloudkit.title']['value'];
                const fileExtension = res.data['results'][0]['rootRecord']['fields']['extension']['value'];
                const filmName = fileName.replace(/\s/g, '_') + '.' + fileExtension;

                let filePath = iCloudUrl.split('/').pop().split('#')[0] + '/' + filmName;

                iCloudUrlToShortcut.set(filePath, iCloudUrl);

                Logger.debug(`Movie title successfully retrieved: ${filmName}`);

                return response.send({url: host + '/api/stream/' + filePath});
            } else {
                Logger.error(`Error from iCloud API: ${serverErrorCode}`);
                return response.status(500).send({err: `Error from iCloud API: ${serverErrorCode}`});
            }
        })
        .catch(error => {
            Logger.error(error);
            response.status(500).send({err: error});
        })
})

app.get('/stream/:fileId/:fileName', (req, res) => {
    const fileId = req.params['fileId'];
    const fileName = req.params['fileName'];

    const iCloudUrl = iCloudUrlToShortcut.get(fileId + '/' + fileName);

    if (isEmpty(fileId) || isEmpty(fileName) || iCloudUrl === undefined) {
        res.status(400).send({err: 'fileId and fileName required'});
        Logger.error(`fileId (${fileId}) and fileName (${fileName}) required`);
        return
    }

    streamFile(iCloudUrl, req, res);
})

function streamFile(iCloudUrl, req, res) {
    getStreamParams(iCloudUrl)
        .then(({directUrl, contentLength}) => {
            const rangeHeader = req.headers.range;

            if (isEmpty(rangeHeader)) {
                res.writeHead(200, {
                    "Content-Length": contentLength,
                    "Content-Type": "video/mp4"
                });

                return res.end()
            }

            const {start, end} = getRange(rangeHeader, contentLength);
            if (start >= contentLength || end >= contentLength) {
                res.writeHead(416, {
                    "Content-Range": `bytes */${contentLength}`
                });
                return res.end();
            }

            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${contentLength}`,
                "Accept-Ranges": "bytes",
                "Content-Length": contentLength,
                "Content-Type": "video/mp4"
            });

            startStreaming(directUrl, iCloudUrl, rangeHeader, res);
        })
}

function startStreaming(directUrl, iCloudUrl, rangeHeader, res) {
    const downloadStream = got.stream(directUrl, getStreamOptions(rangeHeader));

    pipeline(downloadStream, res)
        .then(() => Logger.debug(`Stream Started`))
        .catch((error) => {
            if (error !== undefined && error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                downloadStream.destroy();
                Logger.error('Stream Closed:', error.message)
            }

            if (error !== undefined && error.response && error.response.statusCode === 410) {
                Logger.debug('Refresh iCloud URL');
                Logger.error('Stream Closed', error)
                downloadStream.destroy();

                getStreamParams(iCloudUrl, true)
                    .then(({directUrl}) => startStreaming(directUrl, iCloudUrl, rangeHeader, res))
                    .catch(error => Logger.error(error));
            }
        });
}

const cache = new Map;

function getStreamParams(iCloudUrl, removeUrlFromCache) {
    let cachedStreamParams = cache.get(iCloudUrl);
    if (!!cachedStreamParams && !removeUrlFromCache) {
        Logger.debug(`Get stream params from cache for ${iCloudUrl}`)
        return new Promise(resolve => resolve(cachedStreamParams))
    }

    Logger.debug(`Get stream params for ${iCloudUrl}`)
    return findDirectUrlViaAPI(iCloudUrl)
        .catch(err => {
            Logger.error(err)
        })
}

function findDirectUrlViaAPI(iCloudUrl) {
    return axios.post(ICLOUD_API, {
        "shortGUIDs": [{"value": getFileId(iCloudUrl)}]
    })
        .then(res => {
            if (res.status === 200) {
                let directUrl = res.data['results'][0]['rootRecord']['fields']['fileContent']['value']['downloadURL'];
                let contentLength = res.data['results'][0]['rootRecord']['fields']['size']['value'];

                let streamParams = {
                    directUrl: directUrl,
                    contentLength: parseInt(contentLength, 10)
                };

                cache.set(iCloudUrl, streamParams);

                return streamParams;
            }
        })
}

app.listen(port, '0.0.0.0', () => {
    Logger.debug(`iCloud Streamer listening on port ${port}`)
});
