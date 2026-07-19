"use client";

import { useState } from "react";

import { getPublicAuthErrorMessage } from "@/lib/auth/public-errors";

type EnrollmentState = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type EnrollmentStartResponse =
  | ({
      status: "enrollment_started";
    } & EnrollmentState)
  | { status: "error"; code: string };

type EnrollmentVerifyResponse =
  | { status: "verified"; redirectTo: string }
  | { status: "error"; code: string };

export function AdminMfaEnrollment() {
  const [enrollment, setEnrollment] = useState<EnrollmentState | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  async function startEnrollment() {
    setIsStarting(true);
    setMessage(null);
    setCode("");

    try {
      const response = await fetch("/api/v1/auth/mfa/enroll/start", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const result = (await response.json()) as EnrollmentStartResponse;

      if (result.status === "enrollment_started") {
        setEnrollment({
          factorId: result.factorId,
          qrCode: result.qrCode,
          secret: result.secret,
        });
        return;
      }

      setEnrollment(null);
      setMessage(
        getPublicAuthErrorMessage(result.code) ??
          "인증 앱 등록을 시작할 수 없습니다.",
      );
    } catch {
      setEnrollment(null);
      setMessage("인증 앱 등록을 시작할 수 없습니다.");
    } finally {
      setIsStarting(false);
    }
  }

  async function verifyEnrollment() {
    if (!enrollment) {
      return;
    }

    setIsVerifying(true);
    setMessage(null);

    try {
      const response = await fetch("/api/v1/auth/mfa/enroll/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          factor_id: enrollment.factorId,
          code,
        }),
      });
      const result = (await response.json()) as EnrollmentVerifyResponse;

      if (result.status === "verified") {
        setEnrollment(null);
        setCode("");
        window.location.assign(result.redirectTo);
        return;
      }

      setCode("");
      setMessage(
        getPublicAuthErrorMessage(result.code) ??
          "인증 코드를 확인해 주세요.",
      );
    } catch {
      setCode("");
      setMessage("인증 코드를 확인해 주세요.");
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <section className="flex flex-col gap-6 border border-zinc-200 p-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Authenticator app</h2>
        <p className="text-sm leading-6 text-zinc-600">
          Register a local TOTP authenticator before opening the admin
          workspace.
        </p>
      </div>

      {message ? (
        <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {message}
        </p>
      ) : null}

      {!enrollment ? (
        <button
          className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isStarting}
          onClick={startEnrollment}
          type="button"
        >
          {isStarting ? "Starting..." : "Start enrollment"}
        </button>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Authenticator QR code"
              className="h-52 w-52 border border-zinc-200 bg-white p-3"
              src={enrollment.qrCode}
            />
            <label className="flex flex-col gap-2 text-sm font-medium">
              Manual secret
              <input
                className="h-11 border border-zinc-300 px-3 font-mono text-sm"
                readOnly
                type="text"
                value={enrollment.secret}
              />
            </label>
          </div>

          <label className="flex flex-col gap-2 text-sm font-medium">
            6-digit code
            <input
              autoComplete="one-time-code"
              className="h-11 border border-zinc-300 px-3 text-base"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              onChange={(event) => setCode(event.target.value)}
              pattern="[0-9]{6}"
              required
              type="text"
              value={code}
            />
          </label>

          <button
            className="h-11 border border-zinc-950 bg-zinc-950 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isVerifying || code.length !== 6}
            onClick={verifyEnrollment}
            type="button"
          >
            {isVerifying ? "Verifying..." : "Verify authenticator"}
          </button>
        </div>
      )}
    </section>
  );
}
