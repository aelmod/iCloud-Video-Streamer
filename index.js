import puppeteer from 'puppeteer';
import got from 'got';
import stream from 'stream';
import util from 'util';
import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import {v4 as uuidv4} from 'uuid';
import {getRange, getFileId, isEmpty, getStreamOptions, isValidHttpUrl} from './util.js'
import 'dotenv/config'

const ICLOUD_API = `https://ckdatabasews.icloud.com/database/1/com.apple.cloudkit/production/public/records/resolve?ckjsBuildVersion=2207ProjectDev37&ckjsVersion=2.6.1&clientBuildNumber=2207Project40&clientMasteringNumber=2207B37&clientId=${uuidv4()}`;

const pipeline = util.promisify(stream.pipeline);

const app = express()
const port = 3000
const host = process.env.HOST

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(bodyParser.raw());

const iCloudUrlToShortcut = new Map;

app.post('/api/stream', (req, res) => {
    const iCloudUrl = req.body.url;
    if (isEmpty(iCloudUrl) || !isValidHttpUrl(iCloudUrl)) {
        res.status(400).send({err: 'URL is not valid'});
        return
    }

    let fileName = iCloudUrl.split('#').pop();
    if (fileName.startsWith('https://')) {
        fileName = 'movie'
    }
    fileName = fileName + '.mp4'

    let filePath = iCloudUrl.split('/').pop().split('#')[0] + '/' + fileName;

    iCloudUrlToShortcut.set(filePath, iCloudUrl);

    res.send({url: host + '/api/stream/' + filePath});
})

app.get('/api/stream/:fileId/:fileName', (req, res) => {
    const fileId = req.params['fileId'];
    const fileName = req.params['fileName'];

    const iCloudUrl = iCloudUrlToShortcut.get(fileId + '/' + fileName);

    if (isEmpty(fileId) || isEmpty(fileName) || iCloudUrl === undefined) {
        res.status(400).send({err: 'fileId and fileName required'});
        return
    }

    streamFile(iCloudUrl, req, res);
})

app.get('/playlist', (req, response) => {
    const iCloudUrl = req.query['url'];
    if (isEmpty(iCloudUrl) || !isValidHttpUrl(iCloudUrl)) {
        response.status(400).send({err: 'URL is not valid'});
        return
    }

    return axios.post(ICLOUD_API, {
        "shortGUIDs": [{"value": getFileId(iCloudUrl)}]
    })
        .then(res => {
            if (res.status === 200) {
                const directUrl = res.data['results'][0]['rootRecord']['fields']['fileContent']['value']['downloadURL'];

                const fileName = res.data['results'][0]['share']['fields']['cloudkit.title']['value'];
                const fileExtension = res.data['results'][0]['share']['fields']['cloudkit.type']['value'];

                response.attachment(fileName + '.' + fileExtension + `.m3u`)
                return response.send(
                    [
                        '#EXTM3U',
                        `#EXTINF:-1,${fileName + '.' + fileExtension}`,
                        directUrl
                    ].join('\n')
                );
            }
        })
        .catch(error => {
            console.error(error)
            response.status(500).send({err: error});
        })
})

app.get('/stream', (req, res) => {
    streamFile(req.query['url'], req, res);
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
        .then(() => console.log(`Stream Started`))
        .catch((error) => {
            if (error !== undefined && error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                downloadStream.destroy();
                console.log('Stream Closed:', error.message)
            }

            if (error !== undefined && error.response && error.response.statusCode === 410) {
                console.log('Refresh iCloud URL');
                console.log('Stream Closed', error)
                downloadStream.destroy();

                getStreamParams(iCloudUrl, true)
                    .then(({directUrl}) => startStreaming(directUrl, iCloudUrl, rangeHeader, res))
                    .catch(error => console.log(error));
            }
        });
}

const cache = new Map;

function getStreamParams(iCloudUrl, removeUrlFromCache) {
    let cachedStreamParams = cache.get(iCloudUrl);
    if (!!cachedStreamParams && !removeUrlFromCache) {
        console.log(`Get stream params from cache for ${iCloudUrl}`)
        return new Promise(resolve => resolve(cachedStreamParams))
    }

    console.log(`Get stream params for ${iCloudUrl}`)
    return findDirectUrlViaAPI(iCloudUrl)
        .catch(err => {
            console.log(err)
            return findDirectUrlViaBrowser(iCloudUrl)
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

function findDirectUrlViaBrowser(iCloudUrl) {
    return (async () => {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto(iCloudUrl);
        await page.waitForSelector('.spinner-wrapper', {hidden: true});
        await page.click('.page-button-three', {delay: 1000});
        setTimeout(() => browser.close(), 10000);

        return new Promise(resolve =>
            page.on('response', response => {
                if (response.status() === 200 && response.url().startsWith("https://cvws.icloud-content.com")) {
                    let streamParams = {
                        directUrl: response.url(),
                        contentLength: parseInt(response.headers()['content-length'], 10)
                    };
                    cache.set(iCloudUrl, streamParams);
                    resolve(streamParams)
                }
            })
        )
    })();
}

app.listen(port, '0.0.0.0', () => {
    console.log(`iCloud Streamer listening on port ${port}`)
});

