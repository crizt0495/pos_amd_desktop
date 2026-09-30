import { PAYMENT_METHOD_LABEL, type ReceiptData } from '@/lib/types';
import { formatTanggalStruk, lineItems } from '@/lib/receipt';
import { rupiah } from '@/lib/format';

/**
 * Struk 58mm. Saat dicetak (window.print) hanya elemen berkelas .receipt-print
 * yang terlihat — lihat @media print di app/globals.css.
 */
export function ReceiptView({ data }: { data: ReceiptData }) {
  const items = lineItems(data);

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
        {items.map((it, i) => (
          <div key={i} className="item">
            <span className="name">{it.name}</span>
            <span className="amt">{it.sub}</span>
          </div>
        ))}

        <hr />

        <div className="rows">
          {data.discountAmount > 0 ? (
            <div>
              <span>Diskon</span>
              <span>-{rupiah(data.discountAmount)}</span>
            </div>
          ) : null}
          <div className="total">
            <span>TOTAL</span>
            <span>{rupiah(data.total)}</span>
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