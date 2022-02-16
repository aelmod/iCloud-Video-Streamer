import puppeteer from 'puppeteer';
import got from 'got';
import stream from 'stream';
import util from 'util';
import express from 'express';
import bodyParser from 'body-parser';

const pipeline = util.promisify(stream.pipeline);

const app = express()
const port = 3000

app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());
app.use(bodyParser.raw());

//TODO: implement API to get link with correct file name
// app.post('/api/stream', (req, res) => {})

app.get('/stream', (req, res) => {
    const iCloudUrl = req.query['url'];

    getStreamParams(iCloudUrl)
        .then(({url, contentLength}) => {
            const rangeHeader = req.headers.range;

            if (isEmpty(rangeHeader)) {
                res.writeHead(200, {
                    "Content-Length": contentLength,
                    "Content-Type": "video/mp4"
                });

                res.end()

                return
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

            startStreaming(url, iCloudUrl, rangeHeader, res);
        })
})

function startStreaming(url, iCloudUrl, range, res) {
    const downloadStream = got.stream(url, getStreamOptions(range));

    pipeline(downloadStream, res)
        .then(() => console.log(`Stream Started`))
        .catch((error) => {
            if (error !== undefined && error.code === 'ERR_STREAM_PREMATURE_CLOSE')
                console.log('Stream Closed')

            if (error !== undefined && error.response && error.response.statusCode === 410) {
                console.log('Refresh iCloud URL');
                downloadStream.destroy();

                getStreamParams(iCloudUrl, true)
                    .then(({url}) => startStreaming(url, iCloudUrl, range, res))
                    .catch(error => console.log(error));
            }
        });
}

const cache = new Map;

function getStreamParams(url, refreshUrlInCache) {
    let cachedStreamParams = cache.get(url);
    if (!!cachedStreamParams && !refreshUrlInCache) {
        console.log(`Get stream params from cache for ${url}`)
        return new Promise(resolve => resolve(cachedStreamParams))
    }

    return (async () => {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        await page.goto(url);
        await page.waitForSelector('.spinner-wrapper', {hidden: true});
        await page.click('.page-button-three', {delay: 1000});
        setTimeout(() => browser.close(), 10000)

        return new Promise(resolve =>
            page.on('response', response => {
                if (response.status() === 200 && response.url().startsWith("https://cvws.icloud-content.com")) {
                    let streamParams = {
                        url: response.url(),
                        contentLength: parseInt(response.headers()['content-length'], 10)
                    };
                    cache.set(url, streamParams);
                    resolve(streamParams)
                }
            })
        )
    })()
}

function getStreamOptions(range) {
    return {
        hooks: {
            beforeRequest: [
                options => {
                    options.headers = {...options.headers, Range: range}
                }
            ]
        }
    };
}

function getRange(rangeHeader, size) {
    let [start, end] = rangeHeader.replace(/bytes=/, "").split("-");
    start = parseInt(start, 10);
    end = end ? parseInt(end, 10) : size - 1;

    if (!isNaN(start) && isNaN(end)) {
        end = size - 1;
    }
    if (isNaN(start) && !isNaN(end)) {
        start = size - end;
        end = size - 1;
    }

    return {start: start, end: end}
}

function isEmpty(str) {
    return (!str || str.length === 0);
}

app.listen(port, '0.0.0.0', () => {
    console.log(`iCloud Streamer listening on port ${port}`)
});

