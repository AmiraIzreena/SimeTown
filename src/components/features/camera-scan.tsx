'use client';

import { Text } from '@/components/ui/localized-text';

import { Camera, CameraOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;
const readerClass = () => (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;

/**
 * Reads a QR code with the device camera, using the browser's own barcode
 * reader. Nothing is uploaded: the picture never leaves the device. Where the
 * browser has no reader, the code printed under the QR is typed instead.
 */
export function CameraScan({ onCode, label = 'Scan with camera', formats = ['qr_code'] }: { onCode: (text: string) => void; label?: string; formats?: string[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const formatKey = formats.join(',');

  useEffect(() => {
    if (!on) return;
    const Reader = readerClass();
    if (!Reader) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const detector = new Reader({ formats: formatKey.split(',') });
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            if (found[0]?.rawValue) {
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
          <Button variant="light" size="sm" className="absolute bottom-3 right-3" onClick={() => setOn(false)}>
            <CameraOff className="size-4" aria-hidden /><Text>Stop</Text></Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            if (!readerClass()) {
              setProblem('This browser cannot read QR codes. Type the code printed under the QR instead.');
              return;
            }
            setProblem(null);
            setOn(true);
          }}
        >
          <Camera className="size-4" aria-hidden />
          <Text>{label}</Text>
        </Button>
      )}
      {problem && <p className="text-sm text-ink-600"><Text>{problem}</Text></p>}
    </div>
  );
}
