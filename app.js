const $ = (selector) => document.querySelector(selector);
const tabs = document.querySelectorAll(".tab");
const video = $("#videoPreview");
const emptyPreview = $("#emptyPreview");
const shotList = $("#shotList");
const progressBox = $("#scanProgress");
const progressText = $("#progressText");
const progressBar = $("#progressBar");
let currentShots = [];
let localObjectUrl = null;

function setMode(mode) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  $("#linkMode").classList.toggle("active", mode === "link");
  $("#fileMode").classList.toggle("active", mode === "file");
}

function status(message) { shotList.innerHTML = `<div class="empty-state">${message}</div>`; }
function showVideo() { video.style.display = "block"; emptyPreview.style.display = "none"; }
function waitFor(target, event, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${event} 超时`)); }, timeout);
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("视频无法解码或读取")); };
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener("error", fail); };
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

async function loadAndScan(src) {
  currentShots = [];
  status("正在读取视频元数据...");
  progressBox.hidden = false; progressBar.value = 0;
  video.pause(); video.removeAttribute("src"); video.load();
  video.src = src; showVideo(); video.load();
  try {
    if (video.readyState < 1) await waitFor(video, "loadedmetadata", 25000);
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("无法取得视频时长");
    await scanVideo(video);
  } catch (error) {
    progressBox.hidden = true;
    status(`扫描失败：${error.message}。目前支持抖音分享链接和视频文件直链，其他平台网页请先下载再上传。`);
  }
}

function seekTo(time) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("视频定位超时")); }, 12000);
    const done = () => { cleanup(); resolve(); };
    const cleanup = () => { clearTimeout(timer); video.removeEventListener("seeked", done); };
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = Math.min(Math.max(time, 0), Math.max(0, video.duration - 0.05));
    if (Math.abs(video.currentTime - time) < 0.02 && video.readyState >= 2) done();
  });
}

function frameMetrics(ctx, width, height) {
  ctx.drawImage(video, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let lum = 0, red = 0, blue = 0, edge = 0, center = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 4, r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const l = .299 * r + .587 * g + .114 * b;
    lum += l; red += r; blue += b;
    if (x > width * .3 && x < width * .7 && y > height * .2 && y < height * .8) center += l;
    if (x >= 2) edge += Math.abs(l - (.299 * pixels[i - 8] + .587 * pixels[i - 7] + .114 * pixels[i - 6]));
  }
  const n = Math.ceil(width / 2) * Math.ceil(height / 2);
  return { lum: lum / n, red: red / n, blue: blue / n, edge: edge / n, center: center / n };
}

function difference(a, b) {
  return (Math.abs(a.lum-b.lum)/255 + Math.abs(a.red-b.red)/255 + Math.abs(a.blue-b.blue)/255 + Math.abs(a.edge-b.edge)/120) / 4;
}

async function scanVideo(target) {
  const duration = target.duration;
  const segmentCount = Math.min(30, Math.max(1, Math.ceil(duration / 10)));
  const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const segments = [];
  target.pause();
  for (let i = 0; i < segmentCount; i++) {
    const start = i * 10, end = Math.min(duration, start + 10);
    const samples = [];
    let thumbnail = "";
    for (const ratio of [.15, .5, .85]) {
      await seekTo(start + (end - start) * ratio);
      if (target.readyState < 2) await waitFor(target, "canplay", 12000);
      samples.push(frameMetrics(ctx, canvas.width, canvas.height));
      if (ratio === .5) thumbnail = canvas.toDataURL("image/jpeg", .72);
    }
    const motion = (difference(samples[0], samples[1]) + difference(samples[1], samples[2])) / 2;
    segments.push({ start, end, metrics: samples[1], motion, thumbnail });
    const percent = Math.round(((i + 1) / segmentCount) * 100);
    progressBar.value = percent; progressText.textContent = `真实抽帧扫描 ${i + 1}/${segmentCount}：${formatTime(start)}-${formatTime(end)}`;
  }
  target.currentTime = 0;
  renderShots(segments.map(analyzeSegment));
  progressText.textContent = `扫描完成：共读取 ${segmentCount * 3} 帧，生成 ${segmentCount} 个片段`;
}

function analyzeSegment(segment, index) {
  const { metrics: m, motion } = segment;
  const movement = motion > .09 ? "快速运动" : motion > .035 ? "平稳扫描" : "固定观察";
  const scan = motion > .035;
  const shotSize = m.center > m.lum * .34 ? "近景倾向" : m.edge > 20 ? "中景倾向" : "全景倾向";
  const light = m.lum < 70 ? "低调光" : m.lum > 175 ? "高调光" : "自然光感";
  const color = m.red > m.blue + 12 ? "暖色调" : m.blue > m.red + 12 ? "冷色调" : "中性色调";
  const title = scan ? `${movement}呈现空间信息` : `${shotSize}稳定呈现画面`;
  return { time: `${formatTime(segment.start)}-${formatTime(segment.end)}`, title, scan, motion: motion > .035, thumbnail: segment.thumbnail,
    tags: [scan ? "扫描镜头" : "观察镜头", movement, shotSize, color, light],
    desc: scan ? `本段三次真实抽帧之间存在明显画面变化，判断为${movement}。画面呈${color}、${light}，构图具有${shotSize}，镜头作用偏向交代空间、跟随主体或引导视线。` : `本段三次真实抽帧变化较小，判断为固定或轻微运动镜头。画面呈${color}、${light}，构图具有${shotSize}，适合承接人物状态与环境关系。` };
}

function renderShots(shots) {
  currentShots = shots; shotList.innerHTML = "";
  shots.forEach((shot) => {
    const card = document.createElement("article"); card.className = `shot-card ${shot.scan ? "scan" : ""}`;
    card.innerHTML = `<div><div class="timecode">${shot.time}</div>${shot.thumbnail ? `<img class="shot-thumbnail" src="${shot.thumbnail}" alt="${shot.time} 抽帧画面">` : ""}</div><div><h3 contenteditable="true">${shot.title}</h3><div class="tags">${shot.tags.map(t => `<span class="tag ${t === "扫描镜头" ? "scan-tag" : ""}">${t}</span>`).join("")}</div><p contenteditable="true">${shot.desc}</p></div>`;
    shotList.appendChild(card);
  });
  $("#shotCount").textContent = shots.length; $("#scanCount").textContent = shots.filter(s => s.scan).length; $("#motionCount").textContent = shots.filter(s => s.motion).length;
}

function formatTime(value) { const sec = Math.max(0, Math.round(value)); return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`; }

tabs.forEach(tab => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
$("#videoFile").addEventListener("change", (event) => { const file = event.target.files[0]; if (!file) return; if (localObjectUrl) URL.revokeObjectURL(localObjectUrl); localObjectUrl = URL.createObjectURL(file); loadAndScan(localObjectUrl); });
$("#analyzeLinkBtn").addEventListener("click", () => { const input = $("#videoUrl").value.trim(); const match = input.match(/https?:\/\/[^\s]+/i); if (!match) return status("请粘贴包含 http 或 https 的视频链接。"); const url = match[0].replace(/[，。；;！!]+$/, ""); loadAndScan(`/proxy-video?url=${encodeURIComponent(url)}`); });
$("#clearBtn").addEventListener("click", () => { video.pause(); video.removeAttribute("src"); video.load(); video.style.display="none"; emptyPreview.style.display="grid"; progressBox.hidden=true; $("#videoUrl").value=""; $("#videoFile").value=""; currentShots=[]; renderShots([]); status("上传视频或粘贴视频直链后，将自动读取真实画面并逐段分析。 "); });
$("#exportBtn").addEventListener("click", () => { if (!currentShots.length) return status("暂无可导出的扫描结果。"); const body = currentShots.map(s => `## ${s.time} ${s.title}\n镜头语言：${s.tags.join(" / ")}\n画面描述：${s.desc}`).join("\n\n"); const url=URL.createObjectURL(new Blob([`# 视频镜头扫描分析\n\n${body}\n`],{type:"text/markdown;charset=utf-8"})); const a=document.createElement("a"); a.href=url; a.download="shot-analysis.md"; a.click(); URL.revokeObjectURL(url); });
status("上传视频或粘贴视频直链后，将自动读取真实画面并逐段分析。");
