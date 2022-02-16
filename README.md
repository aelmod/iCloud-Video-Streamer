iCloud Video Streamer
=============

Stream videos from iCloud

# Install

``` bash
npm i && npm start
```

# Stream video file

Click share on file in Finder or Files and set access setting to `Anyone with the link`.

Then copy iCloud link, encode it using `encodeURIComponent(url)` function in browser console and append encoded link to endpoint. Now link should look like this:
``` bash
http://localhost:3000/stream/https%3A%2F%2Fwww.icloud.com%2Ficlouddrive%2F...
```

And now you can paste it in browser, VLC player etc.
