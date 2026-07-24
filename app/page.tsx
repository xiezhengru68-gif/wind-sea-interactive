"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

type Lyric = { time: number; text: string };
type Bubble = {
  x: number;
  y: number;
  z: number;
  radius: number;
  drift: number;
  phase: number;
  sx: number;
  sy: number;
  sr: number;
  vx: number;
  vy: number;
  squash: number;
  angle: number;
  hue: number;
  cooldown: number;
  hidden: number;
};

type HandPoint = { x: number; y: number; z: number };
type TrackedHand = {
  x: number;
  y: number;
  palmX: number;
  palmY: number;
  pinch: boolean;
  landmarks: HandPoint[];
};
type HandState = {
  x: number;
  y: number;
  active: boolean;
  pinch: boolean;
  trigger: number;
  burstX: number;
  burstY: number;
  landmarks: HandPoint[];
  hands: TrackedHand[];
};
type SmokeParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  phase: number;
  opacity: number;
};
type Pinwheel = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  color: "red" | "blue";
  life: number;
  maxLife: number;
  phase: number;
};
type HandTracker = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => { landmarks?: HandPoint[][] };
  close?: () => void;
};
type DeviceOrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const DEFAULT_TIMELINE = 180;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const lyrics: Lyric[] = [
  { time: 0, text: "风从很远的地方来" },
  { time: 18, text: "蓝色的夜，被一束光轻轻唤醒" },
  { time: 36, text: "伸出手，触碰一颗藏着云雾的泡泡" },
  { time: 54, text: "让白色的烟，沿着指尖散开" },
  { time: 72, text: "转动视线，海与星光正在身边流动" },
  { time: 90, text: "这一刻，风有了方向" },
  { time: 108, text: "这一刻，你也成为舞台的一部分" },
  { time: 126, text: "让所有喧闹，沉进温柔的蓝色" },
  { time: 144, text: "再触碰一颗泡泡，把愿望放进风里" },
  { time: 162, text: "夜晚没有结束，它只是变成了记忆" },
];

export default function Home() {
  const stageRef = useRef<HTMLElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const musicUrlRef = useRef<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const bubbleCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const visualFrameRef = useRef<number | null>(null);
  const bubblesRef = useRef<Bubble[]>([]);
  const smokeRef = useRef<SmokeParticle[]>([]);
  const pinwheelsRef = useRef<Pinwheel[]>([]);
  const burstRequestRef = useRef({ x: .5, y: .5, id: 0 });
  const pointerRef = useRef({ x: .5, y: .5, active: false, lastAt: 0 });
  const windRef = useRef({ x: 1, y: 0, strength: 0 });
  const handRef = useRef<HandState>({
    x: .5,
    y: .5,
    active: false,
    pinch: false,
    trigger: 0,
    burstX: .5,
    burstY: .5,
    landmarks: [],
    hands: [],
  });
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const handTrackerRef = useRef<HandTracker | null>(null);

  const [entered, setEntered] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(.62);
  const [currentTime, setCurrentTime] = useState(0);
  const [songLength, setSongLength] = useState(DEFAULT_TIMELINE);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicName, setMusicName] = useState("未选择音乐");
  const [surround, setSurround] = useState(false);
  const [popped, setPopped] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<"off" | "loading" | "active" | "error">("off");

  const lyricIndex = useMemo(() => {
    let found = 0;
    for (let index = 0; index < lyrics.length; index += 1) {
      if (currentTime >= lyrics[index].time) found = index;
      else break;
    }
    return found;
  }, [currentTime]);

  const currentLyric = lyrics[lyricIndex];
  const previousLyric = lyrics[Math.max(0, lyricIndex - 1)];
  const nextLyric = lyrics[Math.min(lyrics.length - 1, lyricIndex + 1)];

  const applySurroundView = useCallback((rawX: number, rawY: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const x = Math.max(0, Math.min(1, rawX));
    const y = Math.max(0, Math.min(1, rawY));
    const offsetX = x - .5;
    const offsetY = y - .5;
    stage.style.setProperty("--view-x", `${offsetX * -34}px`);
    stage.style.setProperty("--view-y", `${offsetY * -22}px`);
    stage.style.setProperty("--far-x", `${offsetX * -12}px`);
    stage.style.setProperty("--far-y", `${offsetY * -8}px`);
    stage.style.setProperty("--mid-x", `${offsetX * -34}px`);
    stage.style.setProperty("--mid-y", `${offsetY * -22}px`);
    stage.style.setProperty("--near-x", `${offsetX * -82}px`);
    stage.style.setProperty("--near-y", `${offsetY * -48}px`);
    stage.style.setProperty("--rotate-x", `${offsetY * -9}deg`);
    stage.style.setProperty("--rotate-y", `${offsetX * 13}deg`);
  }, []);

  const toggleSurround = useCallback(async () => {
    if (surround) {
      setSurround(false);
      applySurroundView(.5, .5);
      return;
    }
    const OrientationEvent = window.DeviceOrientationEvent as DeviceOrientationWithPermission | undefined;
    try {
      if (OrientationEvent?.requestPermission) await OrientationEvent.requestPermission();
    } catch {
      // Pointer and touch parallax remain available when motion permission is denied.
    }
    setSurround(true);
  }, [applySurroundView, surround]);

  useEffect(() => {
    if (!surround) return;
    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.gamma == null || event.beta == null) return;
      const x = .5 + Math.max(-1, Math.min(1, event.gamma / 42)) * .34;
      const portraitTilt = Math.max(-1, Math.min(1, (event.beta - 48) / 38));
      const y = .5 + portraitTilt * .28;
      pointerRef.current.x += (x - pointerRef.current.x) * .18;
      pointerRef.current.y += (y - pointerRef.current.y) * .18;
      applySurroundView(pointerRef.current.x, pointerRef.current.y);
    };
    window.addEventListener("deviceorientation", handleOrientation, { passive: true });
    return () => window.removeEventListener("deviceorientation", handleOrientation);
  }, [applySurroundView, surround]);

  const connectMusic = useCallback(() => {
    const music = musicRef.current;
    if (!music) return null;
    const AudioContextClass = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = context;
    if (context.state === "suspended") void context.resume();
    if (!mediaSourceRef.current) {
      const source = context.createMediaElementSource(music);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = .88;
      source.connect(analyser).connect(context.destination);
      mediaSourceRef.current = source;
      analyserRef.current = analyser;
    }
    return context;
  }, []);

  const enterConcert = useCallback(async () => {
    const music = musicRef.current;
    setEntered(true);
    if ("vibrate" in navigator) navigator.vibrate([12, 35, 18]);
    if (!music || !musicUrl) return;
    try {
      connectMusic();
      music.volume = volume;
      await music.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, [connectMusic, musicUrl, volume]);

  const togglePlayback = useCallback(async () => {
    const music = musicRef.current;
    if (!music || !musicUrl) return;
    if (!music.paused) {
      music.pause();
      return;
    }
    connectMusic();
    await music.play();
  }, [connectMusic, musicUrl]);

  const chooseMusic = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
    const url = URL.createObjectURL(file);
    musicUrlRef.current = url;
    setMusicUrl(url);
    setMusicName(file.name);
    setCurrentTime(0);
    setSongLength(DEFAULT_TIMELINE);

    const music = musicRef.current;
    if (!music) return;
    music.src = url;
    music.load();
    connectMusic();
    music.volume = volume;
    try {
      await music.play();
      setEntered(true);
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, [connectMusic, volume]);

  const stopCamera = useCallback(() => {
    if (cameraFrameRef.current) cancelAnimationFrame(cameraFrameRef.current);
    cameraFrameRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    handTrackerRef.current?.close?.();
    handTrackerRef.current = null;
    handRef.current = {
      x: .5,
      y: .5,
      active: false,
      pinch: false,
      trigger: 0,
      burstX: .5,
      burstY: .5,
      landmarks: [],
      hands: [],
    };
    setCameraActive(false);
    setCameraStatus("off");
  }, []);

  const toggleCamera = useCallback(async () => {
    if (cameraStreamRef.current) {
      stopCamera();
      return;
    }
    const video = cameraVideoRef.current;
    if (!video) return;
    setCameraStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      const options = {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU" as const,
        },
        runningMode: "VIDEO" as const,
        numHands: 2,
        minHandDetectionConfidence: .55,
        minTrackingConfidence: .55,
      };
      let tracker: HandTracker;
      try {
        tracker = await HandLandmarker.createFromOptions(vision, options) as HandTracker;
      } catch {
        tracker = await HandLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
        }) as HandTracker;
      }
      handTrackerRef.current = tracker;
      setCameraActive(true);
      setCameraStatus("active");
      let lastVideoTime = -1;
      let lastDetectAt = 0;
      const detectHand = () => {
        const now = performance.now();
        if (now - lastDetectAt >= 55 && video.readyState >= 2 && video.currentTime !== lastVideoTime && handTrackerRef.current) {
          lastDetectAt = now;
          lastVideoTime = video.currentTime;
          const result = handTrackerRef.current.detectForVideo(video, now);
          const detectedHands = result.landmarks ?? [];
          if (detectedHands.length > 0) {
            const previousHands = handRef.current.hands;
            const hands: TrackedHand[] = detectedHands.map((points, handIndex) => {
              const index = points[8];
              const thumb = points[4];
              const palm = points[9];
              const previous = previousHands[handIndex];
              const targetX = 1 - index.x;
              const targetPalmX = 1 - palm.x;
              const smoothing = previous ? .42 : 1;
              return {
                x: previous ? previous.x + (targetX - previous.x) * smoothing : targetX,
                y: previous ? previous.y + (index.y - previous.y) * smoothing : index.y,
                palmX: previous ? previous.palmX + (targetPalmX - previous.palmX) * smoothing : targetPalmX,
                palmY: previous ? previous.palmY + (palm.y - previous.palmY) * smoothing : palm.y,
                pinch: Math.hypot(index.x - thumb.x, index.y - thumb.y) < .065,
                landmarks: points,
              };
            });
            const primary = hands[0];
            const moveX = primary.x - handRef.current.x;
            const moveY = primary.y - handRef.current.y;
            const moveDistance = Math.hypot(moveX, moveY);
            if (moveDistance > .022) {
              windRef.current = {
                x: moveX / moveDistance,
                y: moveY / moveDistance,
                strength: Math.min(1.35, Math.max(windRef.current.strength, .55 + moveDistance * 8)),
              };
            }
            const freshPinch = hands.find((candidate, index) => candidate.pinch && !previousHands[index]?.pinch);
            handRef.current = {
              x: primary.x,
              y: primary.y,
              active: true,
              pinch: primary.pinch,
              trigger: handRef.current.trigger + (freshPinch ? 1 : 0),
              burstX: freshPinch?.x ?? handRef.current.burstX,
              burstY: freshPinch?.y ?? handRef.current.burstY,
              landmarks: primary.landmarks,
              hands,
            };
          } else {
            handRef.current.active = false;
            handRef.current.landmarks = [];
            handRef.current.hands = [];
          }
        }
        cameraFrameRef.current = requestAnimationFrame(detectHand);
      };
      detectHand();
    } catch {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
      setCameraActive(false);
      setCameraStatus("error");
    }
  }, [stopCamera]);

  useEffect(() => {
    const canvas = bubbleCanvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const createBubble = (index: number): Bubble => ({
      x: ((index * 47) % 101) / 101,
      y: ((index * 71) % 103) / 103,
      z: .18 + ((index * 29) % 83) / 100,
      radius: index % 9 === 0 ? 25 + (index % 4) * 4 : 5 + (index % 7) * 2,
      drift: .25 + (index % 7) * .08,
      phase: index * 1.73,
      sx: 0,
      sy: 0,
      sr: 0,
      vx: 0,
      vy: 0,
      squash: 0,
      angle: 0,
      hue: 184 + (index * 17) % 105,
      cooldown: 0,
      hidden: 0,
    });
    const bubbleCount = window.innerWidth <= 760 ? 48 : 54;
    bubblesRef.current = Array.from({ length: bubbleCount }, (_, index) => createBubble(index));
    const frequency = new Uint8Array(128);
    const smokeSprite = document.createElement("canvas");
    smokeSprite.width = 96;
    smokeSprite.height = 96;
    const smokeSpriteContext = smokeSprite.getContext("2d");
    if (smokeSpriteContext) {
      const spriteGradient = smokeSpriteContext.createRadialGradient(40, 38, 3, 48, 48, 46);
      spriteGradient.addColorStop(0, "rgba(255,255,255,.96)");
      spriteGradient.addColorStop(.32, "rgba(238,248,255,.74)");
      spriteGradient.addColorStop(.7, "rgba(196,225,244,.26)");
      spriteGradient.addColorStop(1, "rgba(168,207,235,0)");
      smokeSpriteContext.fillStyle = spriteGradient;
      smokeSpriteContext.fillRect(0, 0, 96, 96);
    }
    let last = performance.now();
    let lastBurstRequest = 0;
    let lastHandTrigger = 0;
    let cloudArmed = false;
    let lastCloudSeenAt = 0;
    let lastCloudCompressAt = 0;
    let pinwheelSequence = 0;
    let seededPinwheels = false;
    const smokeLimit = window.innerWidth <= 760 ? 128 : 170;
    const pinwheelLimit = window.innerWidth <= 760 ? 10 : 14;

    const spawnPinwheels = (x: number, y: number, count: number) => {
      for (let index = 0; index < count; index += 1) {
        const maxLife = 7600 + Math.random() * 4200;
        const angle = Math.random() * Math.PI * 2;
        pinwheelsRef.current.push({
          x: x + (Math.random() - .5) * 34,
          y: y + (Math.random() - .5) * 26,
          vx: Math.cos(angle) * (.012 + Math.random() * .026),
          vy: -.018 - Math.random() * .026,
          size: 14 + Math.random() * 9,
          angle,
          spin: (index % 2 === 0 ? 1 : -1) * (.0024 + Math.random() * .0018),
          color: pinwheelSequence++ % 2 === 0 ? "red" : "blue",
          life: maxLife,
          maxLife,
          phase: Math.random() * Math.PI * 2,
        });
      }
      if (pinwheelsRef.current.length > pinwheelLimit) {
        pinwheelsRef.current.splice(0, pinwheelsRef.current.length - pinwheelLimit);
      }
    };

    const burstBubble = (bubble: Bubble) => {
      const radius = Math.max(12, bubble.sr);
      bubble.hidden = 760;
      bubble.cooldown = 900;
      bubble.vx = 0;
      bubble.vy = 0;
      if (smokeRef.current.length > smokeLimit - 22) {
        smokeRef.current.splice(0, smokeRef.current.length - (smokeLimit - 22));
      }
      for (let index = 0; index < 22; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = .018 + Math.random() * .075;
        const maxLife = 1250 + Math.random() * 1150;
        smokeRef.current.push({
          x: bubble.sx + Math.cos(angle) * radius * Math.random() * .34,
          y: bubble.sy + Math.sin(angle) * radius * Math.random() * .28,
          vx: Math.cos(angle) * speed + (Math.random() - .5) * .025,
          vy: Math.sin(angle) * speed * .48 - .025 - Math.random() * .045,
          size: radius * (.2 + Math.random() * .38),
          life: maxLife,
          maxLife,
          phase: Math.random() * Math.PI * 2,
          opacity: .28 + Math.random() * .4,
        });
      }
      spawnPinwheels(bubble.sx, bubble.sy, 1);
      setPopped((value) => value + 1);
      if ("vibrate" in navigator) navigator.vibrate([12, 22, 9]);
    };

    const compressCloudIntoBubble = (x: number, y: number, width: number, height: number) => {
      const bubbles = bubblesRef.current;
      let bubble = bubbles.find((candidate) => candidate.hidden > 0);
      if (!bubble) {
        bubble = bubbles.reduce((smallest, candidate) => candidate.radius < smallest.radius ? candidate : smallest);
      }
      bubble.x = x / width;
      bubble.y = y / height;
      bubble.z = 1;
      bubble.radius = 36;
      bubble.hidden = 0;
      bubble.cooldown = 950;
      bubble.vx = 0;
      bubble.vy = -.00008;
      bubble.squash = 1.08;
      bubble.angle = 0;
      bubble.sx = x;
      bubble.sy = y;
      bubble.sr = 82;
      spawnPinwheels(x, y, 3);
      if ("vibrate" in navigator) navigator.vibrate([10, 18, 24]);
    };

    const draw = (now: number) => {
      const rect = stage.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
      if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
        canvas.width = Math.round(rect.width * ratio);
        canvas.height = Math.round(rect.height * ratio);
      }
      if (!seededPinwheels && stage.dataset.entered === "true") {
        seededPinwheels = true;
        for (let index = 0; index < 4; index += 1) {
          spawnPinwheels(
            rect.width * (.28 + index * .15),
            rect.height * (.76 + index % 2 * .08),
            1,
          );
        }
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      const dt = Math.min(34, now - last);
      last = now;
      const analyser = analyserRef.current;
      let bass = 0;
      let energy = 0;
      if (analyser) {
        analyser.getByteFrequencyData(frequency);
        for (let index = 1; index < 16; index += 1) bass += frequency[index];
        for (let index = 8; index < 76; index += 1) energy += frequency[index];
        bass /= 15 * 255;
        energy /= 68 * 255;
      }
      stage.style.setProperty("--energy", energy.toFixed(3));
      stage.style.setProperty("--bass", bass.toFixed(3));
      const wind = windRef.current;
      wind.strength *= Math.pow(.945, dt / 16.67);

      const hand = handRef.current;
      const pointer = pointerRef.current;
      const trackedHands = hand.active ? hand.hands : [];
      const pointerX = pointer.x * rect.width;
      const pointerY = pointer.y * rect.height;
      const pointerActive = pointer.active && trackedHands.length === 0;

      let burstX = -1000;
      let burstY = -1000;
      let shouldBurst = false;
      if (burstRequestRef.current.id !== lastBurstRequest) {
        lastBurstRequest = burstRequestRef.current.id;
        burstX = burstRequestRef.current.x * rect.width;
        burstY = burstRequestRef.current.y * rect.height;
        shouldBurst = true;
      } else if (hand.active && hand.trigger !== lastHandTrigger) {
        lastHandTrigger = hand.trigger;
        burstX = hand.burstX * rect.width;
        burstY = hand.burstY * rect.height;
        shouldBurst = true;
      }
      if (shouldBurst) {
        let closest: Bubble | null = null;
        let closestDistance = Number.POSITIVE_INFINITY;
        for (const candidate of bubblesRef.current) {
          if (candidate.hidden > 0 || candidate.sr <= 0) continue;
          const distance = Math.hypot(candidate.sx - burstX, candidate.sy - burstY);
          if (distance < candidate.sr + (hand.active ? 34 : 14) && distance < closestDistance) {
            closest = candidate;
            closestDistance = distance;
          }
        }
        if (closest) burstBubble(closest);
      }

      const screenHands = trackedHands.map((tracked) => ({
        ...tracked,
        x: tracked.x * rect.width,
        y: tracked.y * rect.height,
        palmX: tracked.palmX * rect.width,
        palmY: tracked.palmY * rect.height,
      }));

      let cloudGesture: {
        first: (typeof screenHands)[number];
        second: (typeof screenHands)[number];
        distance: number;
        strength: number;
        midpointX: number;
        midpointY: number;
      } | null = null;
      if (screenHands.length >= 2) {
        const first = screenHands[0];
        const second = screenHands[1];
        const distance = Math.hypot(second.palmX - first.palmX, second.palmY - first.palmY);
        const spreadThreshold = Math.min(260, Math.max(125, rect.width * .28));
        const compressThreshold = Math.min(100, Math.max(62, rect.width * .11));
        const midpointX = (first.palmX + second.palmX) * .5;
        const midpointY = (first.palmY + second.palmY) * .5;
        cloudGesture = {
          first,
          second,
          distance,
          strength: Math.max(0, Math.min(1, (distance - compressThreshold) / (spreadThreshold - compressThreshold))),
          midpointX,
          midpointY,
        };
        lastCloudSeenAt = now;
        if (distance > spreadThreshold) cloudArmed = true;
        if (cloudArmed && distance < compressThreshold && now - lastCloudCompressAt > 1350) {
          compressCloudIntoBubble(midpointX, midpointY, rect.width, rect.height);
          lastCloudCompressAt = now;
          cloudArmed = false;
        }
      } else if (now - lastCloudSeenAt > 720) {
        cloudArmed = false;
      }

      context.globalCompositeOperation = "screen";
      for (const bubble of bubblesRef.current) {
        if (bubble.hidden > 0) {
          bubble.hidden -= dt;
          if (bubble.hidden <= 0) {
            bubble.y = 1.06 + Math.random() * .18;
            bubble.x = Math.random();
          }
          continue;
        }
        const speed = (.018 + bubble.z * .034 + energy * .07 + Math.abs(wind.y) * wind.strength * .04) * dt / 16.67;
        bubble.y -= speed * .015;
        bubble.x += Math.sin(now * .0005 * bubble.drift + bubble.phase) * .00013 * dt;
        bubble.x += wind.x * wind.strength * .00019 * dt * (.45 + bubble.z);
        bubble.y += wind.y * wind.strength * .00014 * dt * (.45 + bubble.z);
        bubble.x += bubble.vx * dt;
        bubble.y += bubble.vy * dt;
        const drag = Math.pow(.9, dt / 16.67);
        bubble.vx *= drag;
        bubble.vy *= drag;
        bubble.squash += (0 - bubble.squash) * Math.min(1, dt * .008);
        bubble.cooldown -= dt;
        if (bubble.y < -.1) {
          bubble.y = 1.08 + Math.random() * .15;
          bubble.x = Math.random();
        }
        if (bubble.x < -.12) bubble.x = 1.1;
        if (bubble.x > 1.12) bubble.x = -.1;
        const spatialDepth = stage.dataset.surround === "true" ? Math.pow(bubble.z, 1.45) : 0;
        const parallaxX = (pointerRef.current.x - .5) * spatialDepth * 210;
        const parallaxY = (pointerRef.current.y - .5) * spatialDepth * 118;
        const x = bubble.x * rect.width + parallaxX;
        const y = bubble.y * rect.height + parallaxY;
        const radius = bubble.radius * (.55 + bubble.z * 1.55) * (1 + bass * .3);
        bubble.sx = x;
        bubble.sy = y;
        bubble.sr = radius;

        if (pointerActive) {
          const dx = x - pointerX;
          const dy = y - pointerY;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const reach = radius + 28;
          if (distance < reach) {
            const pressure = Math.pow(1 - distance / reach, .72);
            bubble.vx += dx / distance * pressure * .000025 * dt;
            bubble.vy += dy / distance * pressure * .000025 * dt;
            bubble.squash = Math.max(bubble.squash, pressure * .62);
            bubble.angle = Math.atan2(dy, dx);
          }
        }
        for (const tracked of screenHands) {
          const dx = x - tracked.x;
          const dy = y - tracked.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const reach = radius + 58;
          if (distance >= reach) continue;
          const pressure = Math.pow(1 - distance / reach, .72);
          bubble.vx += dx / distance * pressure * .000025 * dt;
          bubble.vy += dy / distance * pressure * .000025 * dt;
          bubble.squash = Math.max(bubble.squash, pressure * (tracked.pinch ? .9 : .62));
          bubble.angle = Math.atan2(dy, dx);
        }

        const squeeze = bubble.squash;
        context.save();
        context.translate(x, y);
        context.rotate(bubble.angle);
        context.scale(1 + squeeze * .5, 1 - squeeze * .34);
        context.shadowColor = `hsla(${bubble.hue}, 100%, 72%, ${.18 + bubble.z * .2})`;
        context.shadowBlur = 8 + bubble.z * 12;
        const gradient = context.createRadialGradient(-radius * .34, -radius * .42, radius * .04, 0, 0, radius);
        gradient.addColorStop(0, `rgba(255,255,255,${.72 + energy * .18})`);
        gradient.addColorStop(.09, `rgba(178,239,255,${.16 + bubble.z * .14})`);
        gradient.addColorStop(.58, `rgba(62,145,255,${.025 + bubble.z * .045})`);
        gradient.addColorStop(.82, `hsla(${bubble.hue}, 100%, 70%, ${.08 + bubble.z * .09})`);
        gradient.addColorStop(1, "rgba(28,78,196,0)");
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.fillStyle = gradient;
        context.fill();
        context.save();
        context.beginPath();
        context.arc(0, 0, radius * .88, 0, Math.PI * 2);
        context.clip();
        context.filter = `blur(${Math.max(1.2, radius * .055)}px)`;
        context.fillStyle = `rgba(238,248,255,${.14 + bubble.z * .12})`;
        for (let cloud = 0; cloud < 3; cloud += 1) {
          const cloudPhase = now * (.00042 + cloud * .000035) + bubble.phase + cloud * 1.9;
          const cloudX = Math.sin(cloudPhase) * radius * (.24 + cloud * .035);
          const cloudY = Math.cos(cloudPhase * .77) * radius * .22 + radius * (.18 - cloud * .1);
          const cloudRadius = radius * (.26 + (cloud % 2) * .12);
          context.beginPath();
          context.ellipse(cloudX, cloudY, cloudRadius, cloudRadius * .72, cloudPhase, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
        context.shadowBlur = 0;
        context.strokeStyle = `rgba(205,245,255,${.3 + bubble.z * .34})`;
        context.lineWidth = Math.max(.65, bubble.z * 1.45);
        context.stroke();
        context.beginPath();
        context.arc(0, 0, radius * .88, Math.PI * 1.08, Math.PI * 1.55);
        context.strokeStyle = `hsla(${205 + bubble.hue % 80}, 100%, 82%, ${.28 + bubble.z * .32})`;
        context.lineWidth = Math.max(.7, radius * .075);
        context.stroke();
        context.beginPath();
        context.arc(0, 0, radius * .94, -.1, .72);
        context.strokeStyle = `hsla(${310 - bubble.hue % 45}, 100%, 80%, ${.16 + bubble.z * .25})`;
        context.lineWidth = Math.max(.55, radius * .045);
        context.stroke();
        context.restore();
      }

      smokeRef.current = smokeRef.current.filter((particle) => {
        particle.life -= dt;
        if (particle.life <= 0) return false;
        particle.x += particle.vx * dt + Math.sin(now * .0018 + particle.phase) * .018 * dt;
        particle.y += particle.vy * dt;
        particle.vy -= .000008 * dt;
        particle.vx *= Math.pow(.994, dt / 16.67);
        particle.size += .014 * dt;
        const age = 1 - particle.life / particle.maxLife;
        const fadeIn = Math.min(1, age * 7);
        const alpha = particle.opacity * fadeIn * Math.pow(1 - age, 1.35);
        particle.vx += wind.x * wind.strength * .00005 * dt;
        particle.vy += wind.y * wind.strength * .000035 * dt;
        context.globalAlpha = alpha;
        context.drawImage(smokeSprite, particle.x - particle.size, particle.y - particle.size, particle.size * 2, particle.size * 2);
        context.globalAlpha = 1;
        return true;
      });

      if (cloudGesture && cloudGesture.strength > .12) {
        context.save();
        context.globalCompositeOperation = "screen";
        const dx = cloudGesture.second.palmX - cloudGesture.first.palmX;
        const dy = cloudGesture.second.palmY - cloudGesture.first.palmY;
        const distance = Math.max(1, cloudGesture.distance);
        const normalX = -dy / distance;
        const normalY = dx / distance;
        const cloudAlpha = Math.min(1, (cloudGesture.strength - .12) / .88);
        context.lineCap = "round";
        context.filter = `blur(${rect.width <= 760 ? 7 : 10}px)`;
        for (let ribbon = 0; ribbon < 3; ribbon += 1) {
          const wave = Math.sin(now * .0016 + ribbon * 2.1) * (10 + cloudGesture.strength * 12);
          context.beginPath();
          context.moveTo(cloudGesture.first.palmX, cloudGesture.first.palmY);
          context.quadraticCurveTo(
            cloudGesture.midpointX + normalX * wave,
            cloudGesture.midpointY + normalY * wave,
            cloudGesture.second.palmX,
            cloudGesture.second.palmY,
          );
          context.strokeStyle = `rgba(226,246,255,${(.055 + ribbon * .018) * cloudAlpha})`;
          context.lineWidth = (22 + ribbon * 9) * (.72 + cloudGesture.strength * .3);
          context.stroke();
        }
        context.filter = "none";
        context.beginPath();
        context.moveTo(cloudGesture.first.palmX, cloudGesture.first.palmY);
        context.quadraticCurveTo(
          cloudGesture.midpointX + normalX * Math.sin(now * .0018) * 8,
          cloudGesture.midpointY + normalY * Math.sin(now * .0018) * 8,
          cloudGesture.second.palmX,
          cloudGesture.second.palmY,
        );
        context.strokeStyle = `rgba(210,242,255,${.11 * cloudAlpha})`;
        context.lineWidth = 3 + cloudGesture.strength * 3;
        context.stroke();
        context.restore();
      }

      if (wind.strength > .045) {
        const length = 70 + wind.strength * 150;
        context.save();
        context.globalCompositeOperation = "screen";
        context.lineCap = "round";
        for (let index = 0; index < 11; index += 1) {
          const phase = (now * (.08 + index * .002) + index * 137) % (rect.width + rect.height);
          const startX = (phase * .83 + index * 97) % rect.width;
          const startY = (phase * .47 + index * 73) % rect.height;
          context.beginPath();
          context.moveTo(startX, startY);
          context.quadraticCurveTo(
            startX + wind.x * length * .5 - wind.y * 8,
            startY + wind.y * length * .5 + wind.x * 8,
            startX + wind.x * length,
            startY + wind.y * length,
          );
          context.strokeStyle = `rgba(181,239,255,${Math.min(.34, wind.strength * .24)})`;
          context.lineWidth = .6 + (index % 3) * .45;
          context.stroke();
        }
        context.restore();
      }

      pinwheelsRef.current = pinwheelsRef.current.filter((pinwheel) => {
        pinwheel.life -= dt;
        if (pinwheel.life <= 0) return false;
        pinwheel.x += pinwheel.vx * dt + wind.x * wind.strength * .028 * dt;
        pinwheel.y += pinwheel.vy * dt + wind.y * wind.strength * .018 * dt;
        pinwheel.vx *= Math.pow(.994, dt / 16.67);
        pinwheel.vy *= Math.pow(.998, dt / 16.67);
        const spinDirection = Math.sign(pinwheel.spin) || 1;
        pinwheel.angle += (pinwheel.spin + spinDirection * (wind.strength * .011 + energy * .004)) * dt;
        const age = 1 - pinwheel.life / pinwheel.maxLife;
        const alpha = Math.min(1, age * 6) * Math.min(1, pinwheel.life / 1100);
        if (pinwheel.y < -pinwheel.size * 3 || pinwheel.x < -pinwheel.size * 4 || pinwheel.x > rect.width + pinwheel.size * 4) {
          return false;
        }

        const primary = pinwheel.color === "red" ? "rgba(255,76,110,.96)" : "rgba(52,178,255,.96)";
        const secondary = pinwheel.color === "red" ? "rgba(255,164,178,.94)" : "rgba(160,232,255,.94)";
        context.save();
        context.globalCompositeOperation = "screen";
        context.globalAlpha = alpha * .92;
        context.translate(pinwheel.x, pinwheel.y);
        context.rotate(Math.sin(now * .0013 + pinwheel.phase) * .09);
        context.strokeStyle = "rgba(218,242,255,.58)";
        context.lineWidth = Math.max(.8, pinwheel.size * .055);
        context.beginPath();
        context.moveTo(0, pinwheel.size * .16);
        context.lineTo(0, pinwheel.size * 1.72);
        context.stroke();
        context.rotate(pinwheel.angle);
        context.shadowColor = pinwheel.color === "red" ? "#ff6f91" : "#55cfff";
        context.shadowBlur = 8;
        for (let blade = 0; blade < 4; blade += 1) {
          context.beginPath();
          context.moveTo(0, 0);
          context.quadraticCurveTo(
            pinwheel.size * .12,
            -pinwheel.size * .72,
            pinwheel.size * .72,
            -pinwheel.size * .48,
          );
          context.quadraticCurveTo(pinwheel.size * .5, -pinwheel.size * .08, 0, 0);
          context.fillStyle = blade % 2 === 0 ? primary : secondary;
          context.fill();
          context.rotate(Math.PI * .5);
        }
        context.shadowBlur = 0;
        context.beginPath();
        context.arc(0, 0, pinwheel.size * .12, 0, Math.PI * 2);
        context.fillStyle = "rgba(248,253,255,.96)";
        context.fill();
        context.restore();
        return true;
      });

      for (const tracked of screenHands) {
        if (tracked.landmarks.length !== 21) continue;
        const joints = tracked.landmarks.map((point) => ({ x: (1 - point.x) * rect.width, y: point.y * rect.height }));
        const links = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
        context.save();
        context.globalCompositeOperation = "screen";
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(142,231,255,.38)";
        context.lineWidth = 3;
        context.shadowColor = "#55d7ff";
        context.shadowBlur = 12;
        context.beginPath();
        for (const [a, b] of links) {
          context.moveTo(joints[a].x, joints[a].y);
          context.lineTo(joints[b].x, joints[b].y);
        }
        context.stroke();
        const tip = joints[8];
        context.beginPath();
        context.arc(tip.x, tip.y, tracked.pinch ? 13 : 9, 0, Math.PI * 2);
        context.fillStyle = tracked.pinch ? "rgba(255,207,246,.62)" : "rgba(194,246,255,.62)";
        context.fill();
        context.restore();
      }
      context.globalCompositeOperation = "source-over";
      visualFrameRef.current = requestAnimationFrame(draw);
    };
    visualFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (visualFrameRef.current) cancelAnimationFrame(visualFrameRef.current);
    };
  }, []);

  useEffect(() => () => {
    if (visualFrameRef.current) cancelAnimationFrame(visualFrameRef.current);
    if (cameraFrameRef.current) cancelAnimationFrame(cameraFrameRef.current);
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    handTrackerRef.current?.close?.();
    void audioContextRef.current?.close();
    if (musicUrlRef.current) URL.revokeObjectURL(musicUrlRef.current);
  }, []);

  const moveView = (event: React.PointerEvent<HTMLElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const now = performance.now();
    const previous = pointerRef.current;
    const elapsed = Math.max(8, now - previous.lastAt);
    const moveX = x - previous.x;
    const moveY = y - previous.y;
    const moveDistance = Math.hypot(moveX, moveY);
    const speed = moveDistance / elapsed * 1000;
    if (previous.active && speed > .18) {
      windRef.current = {
        x: moveX / Math.max(.001, moveDistance),
        y: moveY / Math.max(.001, moveDistance),
        strength: Math.min(1.35, Math.max(windRef.current.strength, .5 + (speed - .18) * .5)),
      };
    }
    pointerRef.current = { x, y, active: true, lastAt: now };
    if (surround) {
      applySurroundView(x, y);
    }

  };

  const requestBubbleBurst = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, input, label")) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    burstRequestRef.current = {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      id: burstRequestRef.current.id + 1,
    };
  };

  const formatTime = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

  return (
    <main
      ref={stageRef}
      className="concert"
      data-entered={entered ? "true" : "false"}
      data-playing={playing ? "true" : "false"}
      data-camera={cameraActive ? "true" : "false"}
      data-surround={surround ? "true" : "false"}
      onPointerMove={moveView}
      onPointerDown={requestBubbleBurst}
      onPointerLeave={() => { pointerRef.current.active = false; }}
    >
      <div className="concert-world" aria-hidden="true">
        <Image className="concert-backdrop" src={`${BASE_PATH}/wind-sea-stage-reimagined-v2.png`} alt="" fill priority sizes="110vw" unoptimized />
        <div className="blue-atmosphere" />
        <div className="light-rig"><i /><i /><i /><i /><i /></div>
        <div className="depth-halo"><i /><i /><i /></div>
        <div className="crowd-near" />
      </div>

      <canvas ref={bubbleCanvasRef} className="bubble-field" aria-label="点击会释放白色烟雾的蓝色泡泡" />

      <audio
        ref={musicRef}
        src={musicUrl ?? undefined}
        loop
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          if (Number.isFinite(duration) && duration > 0) setSongLength(duration);
        }}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime;
          setCurrentTime(time);
        }}
      />

      <div className="camera-peek" data-visible={cameraActive ? "true" : "false"} aria-hidden={!cameraActive}>
        <video ref={cameraVideoRef} muted playsInline />
        <span><i /> 双手拉云 · 合拢成泡</span>
      </div>

      <div className="entry" aria-hidden={entered}>
        <div className="entry-orbit"><i /><i /></div>
        <p>LIVE MEMORY</p>
        <h1>风之海</h1>
        <div className="entry-artist">——华晨宇</div>
        <button type="button" onClick={() => void enterConcert()}>
          <span>开始体验</span><small>音乐可稍后导入</small>
        </button>
      </div>

      <header className="minimal-bar">
        <div className="memory-mark"><i /> WIND SEA <span>LIVE</span></div>
        <div className="concert-actions">
          <button type="button" className={surround ? "active" : ""} onClick={() => void toggleSurround()} aria-pressed={surround} title="开启空间3D环绕；手机可跟随转动">
            <span className="surround-icon">◎</span>{surround ? "3D环绕" : "开启3D"}
          </button>
          <button type="button" className={cameraActive ? "active" : ""} onClick={() => void toggleCamera()} aria-pressed={cameraActive} title="开启摄像头：双手拉开形成云带，合拢压成泡泡；挥手让红蓝风车旋转">
            <span className="camera-icon">◉</span>{cameraStatus === "loading" ? "识别中" : cameraStatus === "error" ? "请授权" : cameraActive ? "双手捏云" : "伸手触碰"}
          </button>
          <label className="music-picker" title={`选择你有权使用的本地音乐 · ${musicName}`}>
            <input type="file" accept="audio/*" onChange={(event) => void chooseMusic(event)} />
            <span>♪</span>{musicUrl ? "换音乐" : "本地音乐"}
          </label>
          <button type="button" disabled={!musicUrl} onClick={() => void togglePlayback()} aria-pressed={playing} title={!musicUrl ? "请先选择本地音乐" : playing ? "暂停" : "播放"}>
            <span>{playing ? "Ⅱ" : "▶"}</span>
          </button>
        </div>
      </header>

      <section className="lyrics-window" aria-live="polite">
        <p key={`previous-${lyricIndex}`} className="lyric-previous">{previousLyric.text}</p>
        <p key={`current-${lyricIndex}`} className="lyric-current">{currentLyric.text}</p>
        <p key={`next-${lyricIndex}`} className="lyric-next">{nextLyric.text}</p>
      </section>

      <footer className="concert-footer">
        <div className="timecode"><span>{formatTime(currentTime)}</span><i><b style={{ width: `${Math.min(100, currentTime / songLength * 100)}%` }} /></i><span>{formatTime(songLength)}</span></div>
        <div className="volume">
          <span>VOL</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.02"
            value={volume}
            aria-label="音乐音量"
            onChange={(event) => {
              const next = Number(event.target.value);
              setVolume(next);
              if (musicRef.current) musicRef.current.volume = next;
            }}
          />
        </div>
        <span className="bubble-count">释放白雾 {String(popped).padStart(2, "0")}</span>
      </footer>
    </main>
  );
}
