/** The workers built into the page, for the single-file build (see workers.ts). */
import VttWorker from './worker/vtt.worker.ts?worker&inline';
import WaveformWorker from './waveform/waveform.worker.ts?worker&inline';

export const createVttWorker = (): Worker => new VttWorker();
export const createWaveformWorker = (): Worker => new WaveformWorker();
