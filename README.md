iCloud Video Streamer
=============

Stream videos from iCloud

# Install

``` bash
npm i && npm start
```

# Stream video file

Click share on file in Finder or Files and set access setting to `Anyone with the link`.

Copy iCloud link and add in the url query param link to endpoint. Now link should look like this:
``` bash
http://192.168.31.147:3000/stream?url=https://www.icloud.com/iclouddrive/...
```

And now you can paste it in browser, VLC player etc.
