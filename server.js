const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, "http://localhost");
  if (parsedUrl.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (parsedUrl.pathname === "/proxy-video") {
    proxyVideo(parsedUrl.searchParams.get("url"), req, res);
    return;
  }

  const cleanPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(root, cleanPath === "/" ? "index.html" : cleanPath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

function proxyVideo(target, req, res) {
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Invalid video url");
    return;
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Only http and https video urls are supported");
    return;
  }

  if (isDouyinUrl(targetUrl)) {
    resolveDouyinVideo(targetUrl)
      .then((videoUrl) => pipeRemoteVideo(new URL(videoUrl), req, res))
      .catch((error) => {
        if (!res.headersSent) res.writeHead(422, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Could not resolve Douyin video: ${error.message}`);
      });
    return;
  }

  pipeRemoteVideo(targetUrl, req, res);
}

function isDouyinUrl(url) {
  return /(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/i.test(url.hostname);
}

function requestBuffer(targetUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = targetUrl.protocol === "https:" ? require("https") : require("http");
    const request = client.get(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        "Accept": "text/html,*/*"
      }
    }, (response) => {
      if (response.headers.location && redirects < 8) {
        response.resume();
        resolve(requestBuffer(new URL(response.headers.location, targetUrl), redirects + 1));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode || 500) >= 400) {
          reject(new Error(`share page returned HTTP ${response.statusCode}`));
          return;
        }
        resolve({ body, finalUrl: targetUrl });
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
  });
}

async function resolveDouyinVideo(targetUrl) {
  const { body: page, finalUrl } = await requestBuffer(targetUrl);
  const playMatch = page.match(/"play_addr"\s*:\s*\{[\s\S]{0,1600}?"url_list"\s*:\s*\["([^"]+)"/);
  const idMatch = finalUrl.pathname.match(/\/video\/(\d+)/) || page.match(/(?:aweme_id|videoId)["'=:\s]+(\d{15,22})/);
  let videoUrl = playMatch && playMatch[1];
  if (!videoUrl) {
    const videoIdMatch = page.match(/"video_id"\s*:\s*"([^"]+)"/) || page.match(/video_id=([^&"\\]+)/);
    if (videoIdMatch) videoUrl = `https://aweme.snssdk.com/aweme/v1/playwm/?video_id=${videoIdMatch[1]}&ratio=720p&line=0`;
  }
  if (!videoUrl && idMatch) {
    throw new Error(`作品 ${idMatch[1]} 的页面未返回播放地址，请稍后重试或上传视频文件`);
  }
  if (!videoUrl) throw new Error("分享页未返回可播放的视频地址，请稍后重试或上传视频文件");
  return videoUrl
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}

function pipeRemoteVideo(targetUrl, req, res, redirects = 0) {
  const client = targetUrl.protocol === "https:" ? require("https") : require("http");
  const headers = {
    "User-Agent": "Mozilla/5.0 DirectorShotScanner/1.0",
    "Accept": "video/*,*/*;q=0.8"
  };

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  const upstream = client.request(targetUrl, { headers }, (upstreamRes) => {
    if (upstreamRes.headers.location && redirects < 8) {
      upstreamRes.resume();
      pipeRemoteVideo(new URL(upstreamRes.headers.location, targetUrl), req, res, redirects + 1);
      return;
    }
    const responseHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": upstreamRes.headers["accept-ranges"] || "bytes",
      "Content-Type": upstreamRes.headers["content-type"] || "video/mp4"
    };

    ["content-length", "content-range"].forEach((name) => {
      if (upstreamRes.headers[name]) {
        responseHeaders[name.replace(/\b\w/g, (char) => char.toUpperCase())] = upstreamRes.headers[name];
      }
    });

    res.writeHead(upstreamRes.statusCode || 200, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Could not load remote video");
  });

  upstream.end();
}

const port = Number(process.env.PORT) || 5177;
server.listen(port, "0.0.0.0", () => {
  console.log(`http://0.0.0.0:${port}`);
});
