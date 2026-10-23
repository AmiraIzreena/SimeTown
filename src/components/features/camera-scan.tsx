'use client';

import { Text } from '@/components/ui/localized-text';

import { Camera, CameraOff, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface DetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<readonly string[]>;
}
const nativeReader = () => (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

/** The barcode reader's WebAssembly file, served from our own site (copied by npm run scanner:sync). */
export const SCANNER_WASM_VERSION = '3.1.3';
const SCANNER_WASM_URL = `/vendor/zxing-wasm-${SCANNER_WASM_VERSION}/zxing_reader.wasm`;

let fallback: Promise<DetectorClass> | null = null;
/** The stand-in reader, loaded once and only on browsers that need it (desktop Chrome and Edge, Firefox, Safari). */
function loadFallback(): Promise<DetectorClass> {
  fallback ??= import('barcode-detector/ponyfill').then(({ BarcodeDetector, prepareZXingModule }) => {
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? SCANNER_WASM_URL : prefix + path) } });
    return BarcodeDetector as unknown as DetectorClass;
  }).catch((error: unknown) => {
    fallback = null; // a failed download can be tried again
    throw error;
  });
  return fallback;
}

/**
 * The reader for these formats: the browser's own when it reads all of them, otherwise the stand-in, which reads QR
 * codes and every label barcode the app asks for. Either way nothing is uploaded: the picture never leaves the device.
 */
async function readerFor(formats: string[]): Promise<DetectorClass> {
  const Native = nativeReader();
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? formats;
      if (formats.every((f) => supported.includes(f))) return Native;
    } catch {
      // The browser's reader cannot say what it reads; use the stand-in.
    }
  }
  return loadFallback();
}

/**
 * Reads a QR code or barcode with the device camera. Phones use the browser's own reader; laptops and other browsers
 * use a stand-in that runs on the device. Typing the code printed under it always works too.
 */
export function CameraScan({ onCode, label = 'Scan with camera', formats = ['qr_code'] }: { onCode: (text: string) => void; label?: string; formats?: string[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const formatKey = formats.join(',');

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    void (async () => {
      let detector: Detector;
      try {
        const Reader = await readerFor(formatKey.split(','));
        detector = new Reader({ formats: formatKey.split(',') });
      } catch {
        if (stopped) return;
        setProblem('The scanner could not start. Type the code printed under the QR or barcode instead.');
        setStarting(false);
        setOn(false);
        return;
      }
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped || !videoRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStarting(false);
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            if (!stopped && found[0]?.rawValue) {
              onCode(found[0].rawValue);
              setOn(false);
              return;
            }
          } catch {
            // A frame that cannot be read yet; try the next one.
          }
          timer = window.setTimeout(tick, 350);
        };
        void tick();
      } catch {
        if (stopped) return;
        setProblem('The camera could not be opened. Allow camera access, or type the code instead.');
        setStarting(false);
        setOn(false);
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [on, onCode, formatKey]);

  return (
    <div className="space-y-3">
      {on ? (
        <div className="relative overflow-hidden rounded-lg bg-ink-900">
          <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
          <span aria-hidden className="pointer-events-none absolute inset-[18%] rounded-xl border-4 border-white/80" />
          {starting && (
            <p role="status" className="absolute inset-0 grid place-items-center text-sm font-medium text-white/90">
              <span className="inline-flex items-center gap-2"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /><Text>Starting the camera…</Text></span>
            </p>
          )}
          <Button variant="light" size="sm" className="absolute bottom-3 right-3" onClick={() => { setOn(false); setStarting(false); }}>
            <CameraOff className="size-4" aria-hidden /><Text>Stop</Text></Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            setProblem(null);
            setStarting(true);
            setOn(true);
          }}
        >
          <Camera className="size-4" aria-hidden />
          <Text>{label}</Text>
        </Button>
      )}
      {problem && <p role="alert" className="text-sm text-ink-600"><Text>{problem}</Text></p>}
    </div>
  );
}
