iCloud Video Streamer
=============

Stream videos from iCloud

# Install

``` bash
npm i && npm start
```

# Docker
Rename .env.example to .env and change host
``` bash
docker build -t icloud-streamer:latest .
docker run -d --restart unless-stopped -p 3000:3000 icloud-streamer:latest
```

# Share video file

Click share on file in Finder or Files and set access setting to `Anyone with the link` and copy iCloud link.

---

Stream video file via API endpoints:

**Get stream URL**
----
Returns URL to stream

* **URL:**

  `/api/stream`

* **Method:**

  `POST`

* **Data Params:**

  `{ "url": "https://www.icloud.com/iclouddrive/...#..." }`

* **Success Response:**

    * **Code:** 200 OK<br />
      **Content:** `{ url: "http://localhost:3000/stream/.../01-_Pilot.mp4" }`

* **Error Response:**

    * **Code:** 400 BAD REQUEST <br />
      **Content:** `{ "err":"URL is not valid" }`

**Get stream**
----
Proxy file URL (you can paste it in browser, VLC player etc.)

* **URL:**

  `/stream`

* **Method:**

  `GET`

* **Success Response:**

    * **Code:** 200 OK<br />
      **Content:** `empty`

  OR

    * **Code:** 206 PARTIAL CONTENT <br />
      **Content:** `HTTP range stream`

* **Error Response:**

    * **Code:** 400 BAD REQUEST <br />
      **Content:** `{ "err":"fileId and fileName required" }`

