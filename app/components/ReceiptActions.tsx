"use client";

import Link from "next/link";
import type { PurchaseSource } from "@/lib/app/types";
import { useApi } from "./useApi";

interface Props {
  receiptId: string;
  source: PurchaseSource;
  amountCents: number;
  canRepeat: boolean;
  canRefund: boolean;
}

export function ReceiptActions({ receiptId, source, amountCents, canRepeat, canRefund }: Props) {
  const { call, busy, error } = useApi();
  return (
    <div className="stack-sm">
      {error && <p className="error">{error.error}</p>}
      <div className="actions">
        <Link className="btn" href="/rebuys">
          Back to rebuys
        </Link>
        {canRepeat && (
          <button className="btn outline" disabled={!!busy} onClick={() => call("repeat", "/api/pay", "POST", { source, approved: { amountCents } })}>
            {busy === "repeat" ? "Sending…" : "Send the same yes again"}
          </button>
        )}
        {canRefund && (
          <button
            className="btn danger"
            disabled={!!busy}
            onClick={() => {
              if (window.confirm("Refund this charge in full?")) void call("refund", `/api/receipts/${receiptId}/refund`, "POST");
            }}
          >
            {busy === "refund" ? "Refunding…" : "Refund"}
          </button>
        )}
      </div>
    </div>
  );
}
