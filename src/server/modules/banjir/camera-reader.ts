import { z } from 'zod';
import { FLOOD_TEST_PICTURES, type FloodTestPictureId } from '@/shared/domain';
import { readWaterLevel, type Photo } from '../../ai/classifier';
import { getConfig } from '../../config';
import { log } from '../../logger';

/**
 * The one place a drain camera picture becomes a water-level reading: a level with a confidence.
 * Whatever reads the picture, the Banjir rules decide what the reading means (two different sources
 * must agree, and a confidence below 0.6 is not trusted), so swapping the reader never changes a rule.
 *
 * Three readers, from prototype to production:
 *   - TEST_SET      The prototype's labelled test pictures, each with a known reading (no model is called).
 *   - HOSTED_AI     A general vision model (AI_PROVIDER) reads an uploaded photo: a CCTV stand-in for demos.
 *   - MODEL_SERVER  A water-level model you train and host, such as a CNN (segmentation of the water line
 *                   on the measuring post) trained on the township's own CCTV frames. Set FLOOD_MODEL_URL.
 *
 * The model server contract (so a data-science team can build it independently):
 *   POST FLOOD_MODEL_URL   Authorization: Bearer FLOOD_MODEL_TOKEN (if set)
 *   body  {"image": "<base64>", "mime": "image/jpeg" | "image/png"}
 *   reply {"levelPct": 0-100 | null, "confidence": 0-1}
 * Later, a CCTV frame grabber posts each camera's latest frame through the same readPhoto().
 */

export type CameraReaderName = 'TEST_SET' | 'HOSTED_AI' | 'MODEL_SERVER';

export interface CameraReading {
  levelPct: number | null;
  confidence: number;
  reader: CameraReaderName;
}

/** The reader an uploaded photo goes to: your own model first, then the hosted AI. Null when neither is set up. */
export function photoReader(): Exclude<CameraReaderName, 'TEST_SET'> | null {
  const config = getConfig();
  if (config.FLOOD_MODEL_URL) return 'MODEL_SERVER';
  if (config.AI_PROVIDER !== 'none') return 'HOSTED_AI';
  return null;
}

/** A labelled test picture: its recorded reading, as the prototype has always used. */
export function readTestPicture(pictureId: FloodTestPictureId): CameraReading & { truePct: number } {
  const picture = FLOOD_TEST_PICTURES.find((p) => p.id === pictureId)!;
  return { levelPct: picture.readPct, confidence: picture.confidence, reader: 'TEST_SET', truePct: picture.truePct };
}

const modelReply = z.object({ levelPct: z.number().min(0).max(100).nullable(), confidence: z.number().min(0).max(1) });

async function askModelServer(photo: Photo): Promise<{ levelPct: number | null; confidence: number } | null> {
  const config = getConfig();
  try {
    const response = await fetch(config.FLOOD_MODEL_URL!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(config.FLOOD_MODEL_TOKEN ? { authorization: `Bearer ${config.FLOOD_MODEL_TOKEN}` } : {}) },
      body: JSON.stringify({ image: Buffer.from(photo.bytes).toString('base64'), mime: photo.mime }),
      signal: AbortSignal.timeout(config.AI_TIMEOUT_SECONDS * 1000),
    });
    if (!response.ok) throw new Error(`Model server answered ${response.status}`);
    const parsed = modelReply.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch (error) {
    log.warn('Flood model server unavailable', { error: String(error) });
    return null;
  }
}

/**
 * Reads a photo with the configured reader. Returns null when no reader is set up or it could not
 * answer; the caller then records nothing, so a failed read can neither raise nor clear an alert.
 */
export async function readPhoto(photo: Photo): Promise<CameraReading | null> {
  const reader = photoReader();
  if (!reader) return null;
  const answer = reader === 'MODEL_SERVER' ? await askModelServer(photo) : await readWaterLevel(photo);
  return answer ? { ...answer, reader } : null;
}
