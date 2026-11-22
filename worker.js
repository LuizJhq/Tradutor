// Reconhecimento de voz local (Whisper base, WASM q8) – fora da thread principal, sem censura.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';

env.allowLocalModels = false;
// Número fixo: o Brave falsifica navigator.hardwareConcurrency e pode reportar só 2 núcleos.
env.backends.onnx.wasm.numThreads = 4;

const HALLUCINATION = /amara\.org|legendas pela|subt[ií]tulos|^\W*$|^\[.*\]$|^\(.*\)$/i;
let asr;
let queue = Promise.resolve();

async function load() {
  const files = new Map();
  asr = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (p) => {
      if (p.status !== 'progress') return;
      files.set(p.file, p.loaded || 0);
      let loaded = 0;
      for (const v of files.values()) loaded += v;
      postMessage({ type: 'progress', loaded });
    },
  });
  await asr(new Float32Array(8000), { language: 'en', max_new_tokens: 1 }); // aquecimento
  postMessage({ type: 'ready' });
}

async function transcribe({ id, audio, language }) {
  const { text } = await asr(audio, { language, task: 'transcribe', max_new_tokens: 128, no_repeat_ngram_size: 4 });
  const t = text.trim();
  postMessage({ type: 'result', id, text: HALLUCINATION.test(t) ? '' : t });
}

onmessage = ({ data }) => {
  queue = queue
    .then(() => (data.type === 'load' ? load() : transcribe(data)))
    .catch((e) => postMessage({ type: 'error', id: data.id, message: e?.message || String(e) }));
};
