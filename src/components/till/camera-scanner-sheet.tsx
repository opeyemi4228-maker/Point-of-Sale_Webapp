"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { useCameraScanner } from "@/lib/hooks/use-camera-scanner";

/**
 * Camera scanning — SPEC §15.1.
 *
 * For the QR labels the branch prints for loose goods, and for a till without a
 * hardware scanner. The reticle is a frame, not a laser line: what it is
 * actually telling the cashier is "hold the label inside this", and a decorated
 * animation would only make a slow decode look broken.
 *
 * Closes itself on a hit. One scan, one product — leaving it open would keep
 * firing at the same label as the cashier lowers the phone.
 */
export function CameraScannerSheet({
  onDetect,
  onClose,
}: {
  onDetect: (barcode: string) => void;
  onClose: () => void;
}) {
  const { error, videoRef, start, stop } = useCameraScanner((barcode) => {
    onDetect(barcode);
    onClose();
  });

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan with the camera"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4"
    >
      <div className="w-full max-w-128 overflow-hidden rounded-panel bg-surface shadow-raised">
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="font-display text-title font-bold text-ink">
            Scan a barcode or QR
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the camera"
            className="grid size-touch-till place-items-center rounded-input text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
          >
            <X size={24} />
          </button>
        </header>

        <div className="p-5">
          {error ? (
            <Alert tone="signal" title="Cannot use the camera">
              {error}
            </Alert>
          ) : (
            <div className="relative aspect-4/3 overflow-hidden rounded-panel bg-ink">
              <video
                ref={videoRef}
                playsInline
                muted
                className="size-full object-cover"
              />

              {/* The reticle. Purely a guide, so it is hidden from assistive
                  technology and never blocks a tap. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 grid place-items-center"
              >
                <div className="size-3/5 rounded-panel border-4 border-white/85 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
              </div>
            </div>
          )}

          <p className="mt-4 text-body text-ink-70">
            Hold the label inside the frame. The sale continues as normal if the
            camera cannot read it — type the code into the scan field instead.
          </p>
        </div>
      </div>
    </div>
  );
}
