import { PAYMENT_METHOD_LABEL, type ReceiptData } from '@/lib/types';
import { barisStruk, formatTanggalStruk, ringkasanStruk } from '@/lib/receipt';
import { rupiah } from '@/lib/format';

/**
 * Struk 58mm. Saat dicetak (window.print) hanya elemen berkelas .receipt-print
 * yang terlihat — lihat @media print di app/globals.css.
 *
 * Format item sengaja 4 baris supaya potongan per item terlihat jelas:
 *   Nama Item
 *     2 x Rp. 3.500              Rp. 7.000
 *     Pot/Diskon 10%             -Rp. 700
 *                                Rp. 6.300
 */
export function ReceiptView({ data }: { data: ReceiptData }) {
  const baris = barisStruk(data);
  const { subtotalKotor, totalPotongan, total } = ringkasanStruk(data, baris);

  return (
    <div className="receipt-shell">
      <div className="receipt receipt-print">
        <h1>{data.storeName}</h1>
        {data.storeAddress ? <p className="center">{data.storeAddress}</p> : null}
        {data.storePhone ? <p className="center">Telp: {data.storePhone}</p> : null}

        <hr />

        <div className="rows">
          <div>
            <span>No</span>
            <span>{data.invoiceNo}</span>
          </div>
          <div>
            <span>Tgl</span>
            <span>{formatTanggalStruk(data.createdAt)}</span>
          </div>
          <div>
            <span>Kasir</span>
            <span>{data.cashierName}</span>
          </div>
        </div>

        <hr />

        <div className="item-head">
          <span>Item</span>
          <span>Jumlah</span>
        </div>
        {baris.map((b, i) => (
          <div key={i} className="item">
            <span className="name">{b.name}</span>
            <span className="line">
              <span>
                {b.qty} x {rupiah(b.price)}
              </span>
              <span>{rupiah(b.gross)}</span>
            </span>
            {b.discount > 0 ? (
              <span className="line disc">
                <span>
                  Pot/Diskon{b.discountPct != null ? ` ${b.discountPct}%` : ''}
                </span>
                <span>-{rupiah(b.discount)}</span>
              </span>
            ) : null}
            <span className="line net">
              <span />
              <span>{rupiah(b.net)}</span>
            </span>
          </div>
        ))}

        <hr />

        <div className="rows">
          <div>
            <span>SUBTOTAL</span>
            <span>{rupiah(subtotalKotor)}</span>
          </div>
          {totalPotongan > 0 ? (
            <div>
              <span>TOTAL POTONGAN</span>
              <span>-{rupiah(totalPotongan)}</span>
            </div>
          ) : null}
          <div className="total">
            <span>TOTAL</span>
            <span>{rupiah(total)}</span>
          </div>
          <div>
            <span>Bayar</span>
            <span>{rupiah(data.paid)}</span>
          </div>
          <div>
            <span>Kembali</span>
            <span>{rupiah(data.changeDue)}</span>
          </div>
        </div>

        <hr />

        <div className="rows">
          <div>
            <span>Metode</span>
            <span>
              {PAYMENT_METHOD_LABEL[data.paymentMethod as keyof typeof PAYMENT_METHOD_LABEL] ??
                data.paymentMethod}
            </span>
          </div>
        </div>

        {data.note ? (
          <p className="center">Catatan: {data.note}</p>
        ) : null}

        <p className="center" style={{ marginTop: 6 }}>
          Terima kasih atas kunjungan Anda!
        </p>
        <p className="center">Barang yang sudah dibeli tidak dapat ditukar</p>
      </div>
    </div>
  );
}