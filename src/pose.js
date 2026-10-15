// IA de detecção de corpo (MoveNet Thunder, TensorFlow.js), rodando no navegador.
// Usa a placa de vídeo (WebGL) quando existe e WebAssembly quando não.
// Encontra ombros, cotovelos, punhos e quadris; as áreas de estampa são
// calculadas a partir desses pontos (ver photoAreas em photos.js).
const TF = '4.22.0';
const CDN = 'https://cdn.jsdelivr.net/npm';

const loaded = {};
function script(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { delete loaded[src]; reject(new Error('falha ao baixar a biblioteca')); };
    document.head.append(s);
  });
  return loaded[src];
}

const hasWebGL = () => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } };

let detectorPromise = null;
function getDetector() {
  detectorPromise ||= (async () => {
    await script(`${CDN}/@tensorflow/tfjs-core@${TF}/dist/tf-core.min.js`);
    await script(`${CDN}/@tensorflow/tfjs-converter@${TF}/dist/tf-converter.min.js`);
    await script(`${CDN}/@tensorflow/tfjs-backend-cpu@${TF}/dist/tf-backend-cpu.min.js`);
    const tf = window.tf;
    let backend = 'cpu';
    if (hasWebGL()) {
      await script(`${CDN}/@tensorflow/tfjs-backend-webgl@${TF}/dist/tf-backend-webgl.min.js`);
      if (await tf.setBackend('webgl').catch(() => false)) backend = 'webgl';
    }
    if (backend === 'cpu') {
      await script(`${CDN}/@tensorflow/tfjs-backend-wasm@${TF}/dist/tf-backend-wasm.min.js`);
      tf.wasm.setWasmPaths(`${CDN}/@tensorflow/tfjs-backend-wasm@${TF}/dist/`);
      if (await tf.setBackend('wasm').catch(() => false)) backend = 'wasm';
      else await tf.setBackend('cpu');
    }
    await tf.ready();
    await script(`${CDN}/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js`);
    const pd = window.poseDetection;
    return pd.createDetector(pd.SupportedModels.MoveNet, { modelType: pd.movenet.modelType.SINGLEPOSE_THUNDER });
  })().catch((e) => { detectorPromise = null; throw new Error(`Não foi possível carregar a IA de detecção (${e.message || e}).`); });
  return detectorPromise;
}

const NAMES = { nose: 'nose', ls: 'left_shoulder', rs: 'right_shoulder', le: 'left_elbow', re: 'right_elbow', lw: 'left_wrist', rw: 'right_wrist', lh: 'left_hip', rh: 'right_hip', lear: 'left_ear', rear: 'right_ear' };

/**
 * Retorna { ok, pts: {nome: {x, y, v}} (normalizado 0–1), facing } ou { ok: false }.
 * `facing` = 'back' quando o rosto não aparece (foto de costas).
 */
export async function detectPose(img) {
  const detector = await getDetector();
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const [pose] = await detector.estimatePoses(img, { flipHorizontal: false });
  if (!pose) return { ok: false, at: Date.now() };
  const byName = Object.fromEntries(pose.keypoints.map((k) => [k.name, k]));
  const pts = {};
  for (const [k, n] of Object.entries(NAMES)) {
    const q = byName[n];
    pts[k] = { x: +(q.x / W).toFixed(4), y: +(q.y / H).toFixed(4), v: +(q.score ?? 0).toFixed(2) };
  }
  const ok = pts.ls.v > 0.35 && pts.rs.v > 0.35 && Math.abs(pts.ls.x - pts.rs.x) > 0.04;
  // A IA marca ombro esquerdo/direito anatômicos: de frente, o esquerdo da
  // pessoa aparece à direita da imagem; de costas, à esquerda.
  const facing = pts.ls.x >= pts.rs.x ? 'front' : 'back';
  return { ok, pts, facing, at: Date.now() };
}
