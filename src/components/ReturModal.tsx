'use client';

import * as React from 'react';
import { Loader2, Undo2 } from 'lucide-react';

import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useButtonGuard } from '@/lib/useButtonGuard';
import { returnsApi } from '@/lib/api';
import { rupiah } from '@/lib/format';
import type { Transaction, TransactionItem } from '@/lib/types';

/**
 * Refund proporsional untuk qty yang diretur dari satu baris item.
 * Rumus SAMA persis dengan RPC `kasir_create_return`:
 *   refund = harga x qty_retur - round(potongan_baris x qty_retur / qty_asli)
 */
function refundBaris(it: TransactionItem, qty: number): number {
  if (!qty || qty <= 0) return 0;
  const diskonBagian = Math.round((it.discount * qty) / Math.max(it.qty, 1));
  return Math.round(it.price * qty - diskonBagian);
}

export function ReturModal({
  open,
  tx,
  items,
  onClose,
  onSaved,
}: {
  open: boolean;
  tx: Transaction | null;
  items: TransactionItem[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const guard = useButtonGuard();
  const [qty, setQty] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState('');
  // qty yang SUDAH diretur sebelumnya per baris item — dipakai untuk membatasi
  // input supaya tidak kembali melebihi sisa terjual.
  const [direturSebelumnya, setDireturSebelumnya] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    if (!open || !tx) {
      setDireturSebelumnya({});
      return;
    }
    let hidup = true;
    void (async () => {
      const res = await returnsApi.list({ transaction_id: tx.id });
      if (!hidup || !res.ok) return;
      const map: Record<string, number> = {};
      for (const r of res.data ?? []) {
        const its = await returnsApi.items(r.id);
        if (its.ok) {
          for (const it of its.data ?? []) {
            if (it.transaction_item_id) {
              map[it.transaction_item_id] = (map[it.transaction_item_id] ?? 0) + (Number(it.qty) || 0);
            }
          }
        }
      }
      if (hidup) setDireturSebelumnya(map);
    })();
    return () => {
      hidup = false;
    };
  }, [open, tx?.id]);

  // Reset isian tiap kali modal dibuka untuk transaksi (baru) tertentu.
  React.useEffect(() => {
    if (open) {
      setQty({});
      setNote('');
    }
  }, [open, tx?.id]);

  // Per baris: qty terisi & sah (0..sisa terjual).
  const baris = items.map((it) => {
    const raw = (qty[it.id] ?? '').trim();
    const n = raw === '' ? 0 : Number(raw);
    const sudahDiretur = direturSebelumnya[it.id] ?? 0;
    const sisa = Math.max(0, it.qty - sudahDiretur);
    const valid = raw === '' ? true : Number.isFinite(n) && n >= 0 && n <= sisa + 0.0001;
    const efektif = raw === '' ? 0 : Math.min(Math.max(n || 0, 0), sisa);
    return {
      item: it,
      raw,
      n: n || 0,
      valid,
      efektif,
      refund: refundBaris(it, efektif),
    };
  });

  const adaDiretur = baris.some((b) => b.efektif > 0);
  const tidakSah = baris.some((b) => !b.valid);
  const totalRefund = baris.reduce((s, b) => s + b.refund, 0);
  const terkunci = guard.busy || !adaDiretur || tidakSah;

  function simpan() {
    const payload = baris
      .filter((b) => b.efektif > 0)
      .map((b) => ({
        transaction_item_id: b.item.id,
        product_id: b.item.product_id,
        qty: b.efektif,
      }));
    if (!payload.length) return;

    void guard.guard(
      async () => {
        if (!tx) return;
        const res = await returnsApi.create({
          transactionId: tx.id,
          items: payload,
          note: note.trim() || null,
        });
        if (!res.ok) {
          toast.error('Retur gagal', res.error);
          return;
        }
        toast.ok(
          'Retur disimpan',
          `Dana kembali ${rupiah(res.data.total)} — stok produk sudah dikembalikan.`,
        );
        onClose();
        onSaved?.();
      },
      { pesanTunggu: 'Retur sedang diproses…' },
    );
  }

  return (
    <Modal
      open={open}
      title={tx ? `Retur — ${tx.invoice_no}` : 'Retur Penjualan'}
      onClose={() => (guard.busy ? undefined : onClose())}
      width="max-w-lg"
      footer={
        <>
          <button type="button" className="btn-outline" onClick={onClose} disabled={guard.busy}>
            Batal
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={simpan}
            disabled={terkunci}
            data-loading={guard.busy}
          >
            {guard.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            {guard.busy ? 'Memproses…' : 'Simpan Retur'}
          </button>
        </>
      }
    >
      {tx ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-[#f6f9fd] p-3 text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">No. Nota</span>
              <span className="truncate font-semibold text-[#22374b]">{tx.invoice_no}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">Total Awal</span>
              <span className="tnum font-semibold text-[#22374b]">{rupiah(tx.total)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">Kasir</span>
              <span className="truncate font-semibold text-[#22374b]">{tx.cashier_name || '-'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#5b6b80]">Waktu</span>
              <span className="tnum truncate font-semibold text-[#22374b]">
                {new Date(tx.created_at).toLocaleString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>

          <ul className="divide-y divide-[#eef2f7] rounded-lg border border-[#d8e0ec]">
            {items.map((it) => {
              const b = baris.find((x) => x.item.id === it.id) ?? {
                item: it,
                raw: '',
                n: 0,
                valid: true,
                efektif: 0,
                refund: 0,
              };
              return (
                <li key={it.id} className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-[#35485c]">{it.product_name}</p>
                      <p className="text-[11px] text-[#7a8ba0]">
                        {it.qty} terjual × {rupiah(it.subtotal / Math.max(it.qty, 1))}
                      </p>
                    </div>
                    <input
                      aria-label={`Qty retur ${it.product_name}`}
                      type="number"
                      min={0}
                      max={it.qty}
                      step={1}
                      placeholder="0"
                      value={b.raw}
                      onChange={(e) => setQty((prev) => ({ ...prev, [it.id]: e.target.value }))}
                      className={`cell tnum w-[76px] text-right ${
                        !b.valid
                          ? '!border-[1.5px] !border-[#e03131] bg-[#fff5f5] !text-[#e03131]'
                          : ''
                      }`}
                    />
                    <span className="tnum w-[86px] shrink-0 text-right text-[12px] font-bold text-[#22374b]">
                      {b.refund > 0 ? rupiah(b.refund) : '—'}
                    </span>
                  </div>
                  {!b.valid ? (
                    <p className="mt-1 text-[10.5px] font-semibold text-[#e03131]">
                      Maksimal {it.qty} (terjual)
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <input
            className="input h-9 w-full text-[12px]"
            placeholder="Catatan retur (opsional)…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Catatan retur"
          />

          <div className="flex items-center justify-between rounded-lg bg-[#e8f1fa] px-3 py-2.5">
            <span className="text-[12.5px] font-semibold text-[#134a85]">Total Dana Kembali</span>
            <span data-testid="retur-total" className="tnum text-[16px] font-bold text-[#134a85]">
              {rupiah(totalRefund)}
            </span>
          </div>

          {tidakSah ? (
            <p className="text-[11px] font-semibold text-[#e03131]">
              Periksa jumlah yang diretur — tidak boleh melebihi yang terjual.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}