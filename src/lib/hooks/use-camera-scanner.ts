"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Camera barcode and QR scanning — SPEC §15.1.
 *
 * Uses the platform `BarcodeDetector`, which is present in Chrome and Edge on
 * Android and desktop. That is deliberate rather than lazy: the alternative is
 * shipping a WASM decoder of several hundred kilobytes to every till, and the
 * tills that matter here are Android tablets where the native detector is both
 * present and much faster than a JS decode loop.
 *
 * Where it is missing — Safari, Firefox — `supported` comes back false and the
 * caller falls back to the keyed field. It never throws and never blocks: a
 * camera is a convenience on a till that already has a hardware scanner, and
 * the sale must proceed without it (rule 8).
 */

/** The symbologies a grocery actually puts on a shelf. */
const FORMATS = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

function getDetectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
      .BarcodeDetector ?? null
  );
}

/**
 * Whether this browser can decode at all.
 *
 * Read through `useSyncExternalStore` rather than set from an effect: the
 * server has no `window`, so the server snapshot is `false` and the client
 * snapshot is the real answer. React reconciles the two itself, which avoids
 * both a hydration mismatch and the cascading render that `setState` in an
 * effect would cause. The capability never changes for the life of the page,
 * so there is nothing to subscribe to.
 */
const neverChanges = () => () => {};
const detectorOnClient = () => getDetectorConstructor() !== null;
const detectorOnServer = () => false;

/**
 * Just the capability, for callers that need to decide whether to *offer* the
 * camera before there is anything to scan with. Cheap enough to call anywhere:
 * it subscribes to nothing and allocates nothing.
 */
export function useBarcodeDetectorSupported(): boolean {
  return useSyncExternalStore(neverChanges, detectorOnClient, detectorOnServer);
}

export type CameraScannerState = {
  supported: boolean;
  active: boolean;
  error: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  start: () => Promise<void>;
  stop: () => void;
};

export function useCameraScanner(
  onDetect: (barcode: string) => void,
): CameraScannerState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);

  // The scan loop must not restart every time the parent re-renders a new
  // callback identity, so the live handler is held in a ref and the loop reads
  // through it. Written in an effect, not during render — a ref mutation during
  // render is not safe under concurrent rendering.
  const onDetectRef = useRef(onDetect);
  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = useSyncExternalStore(
    neverChanges,
    detectorOnClient,
    detectorOnServer,
  );

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    const Detector = getDetectorConstructor();
    if (!Detector) {
      setError("This browser cannot use the camera to scan. Type the code instead.");
      return;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The back camera is the one pointed at the shelf.
        video: { facingMode: "environment" },
        audio: false,
      });

      streamRef.current = stream;
      detectorRef.current = new Detector({ formats: FORMATS });

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.srcObject = stream;
      await video.play();
      setActive(true);

      // The same code stays in frame for many frames while the cashier moves
      // the label away. Without this guard one physical scan adds the product
      // thirty times.
      let lastValue = "";
      let lastAt = 0;

      const tick = async () => {
        const detector = detectorRef.current;
        if (!detector || !videoRef.current || videoRef.current.readyState < 2) {
          frameRef.current = requestAnimationFrame(tick);
          return;
        }

        try {
          const found = await detector.detect(videoRef.current);
          const value = found[0]?.rawValue?.trim();
          const now = Date.now();

          if (value && (value !== lastValue || now - lastAt > 1_500)) {
            lastValue = value;
            lastAt = now;
            onDetectRef.current(value);
          }
        } catch {
          // A single failed frame is normal — motion blur, bad light. Keep
          // going rather than tearing the camera down over one bad decode.
        }

        frameRef.current = requestAnimationFrame(tick);
      };

      frameRef.current = requestAnimationFrame(tick);
    } catch (cause) {
      const denied =
        cause instanceof DOMException &&
        (cause.name === "NotAllowedError" || cause.name === "SecurityError");

      setError(
        denied
          ? "Camera permission was refused. Allow it in the browser, or type the code."
          : "No camera available. Type the code instead.",
      );
      stop();
    }
  }, [stop]);

  // Releasing the camera on unmount is not optional: a till that navigates away
  // with the stream open leaves the tablet's camera light on for the rest of
  // the shift.
  useEffect(() => stop, [stop]);

  return { supported, active, error, videoRef, start, stop };
}
