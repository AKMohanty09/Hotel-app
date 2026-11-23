import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import type { Bill, RestaurantSettings, RestaurantTable } from '../types/domain';
import { buildTableQrUrl } from './tableRules';

export async function generateQrDataUrl(url: string, width = 512): Promise<string> {
  return QRCode.toDataURL(url, {
    width,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: {
      dark: '#0F172A',
      light: '#FFFFFF',
    },
  });
}

export async function downloadTableQrPng(
  table: RestaurantTable,
  restaurantName: string,
  origin: string,
  logoUrl?: string
): Promise<void> {
  const url = buildTableQrUrl(origin, table.qrToken);
  const qrDataUrl = await generateQrDataUrl(url, 600);

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 920;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, canvas.width, 138);

  if (logoUrl) {
    try {
      const logoImg = new Image();
      logoImg.crossOrigin = 'anonymous';
      logoImg.src = logoUrl;
      await new Promise<void>((resolve, reject) => {
        logoImg.onload = () => resolve();
        logoImg.onerror = () => reject();
      });
      ctx.save();
      ctx.beginPath();
      ctx.arc(82, 69, 34, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(logoImg, 48, 35, 68, 68);
      ctx.restore();
    } catch {
      // Ignore logo CORS load issues gracefully
    }
  }

  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(restaurantName, canvas.width / 2, 62);

  ctx.fillStyle = '#F59E0B';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`TABLE ${table.tableNumber}  •  ${table.section.toUpperCase()}`, canvas.width / 2, 104);

  const img = new Image();
  img.src = qrDataUrl;
  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
  });
  ctx.drawImage(img, 100, 175, 520, 520);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText('Scan to View Menu & Order', canvas.width / 2, 755);

  ctx.fillStyle = '#64748B';
  ctx.font = '20px monospace';
  ctx.fillText(`Permanent Token: ${table.qrToken}`, canvas.width / 2, 815);
  ctx.font = '18px sans-serif';
  ctx.fillText(`Floor: ${table.floor}  •  Seats: ${table.capacity}`, canvas.width / 2, 855);

  const link = document.createElement('a');
  link.download = `QR-Table-${table.tableNumber}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export async function downloadTablesQrPdf(
  tables: RestaurantTable[],
  restaurantName: string,
  origin: string,
  layout: 'a4-grid' | 'compact-labels' = 'a4-grid'
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const cols = layout === 'a4-grid' ? 2 : 3;
  const rows = layout === 'a4-grid' ? 3 : 4;
  const perPage = cols * rows;
  const pageW = 210;
  const pageH = 297;
  const marginX = 12;
  const marginY = 14;
  const cellW = (pageW - marginX * 2) / cols;
  const cellH = (pageH - marginY * 2) / rows;

  for (let idx = 0; idx < tables.length; idx++) {
    if (idx > 0 && idx % perPage === 0) {
      doc.addPage();
    }
    const posInPage = idx % perPage;
    const col = posInPage % cols;
    const row = Math.floor(posInPage / cols);
    const x = marginX + col * cellW;
    const y = marginY + row * cellH;
    const table = tables[idx];
    const url = buildTableQrUrl(origin, table.qrToken);
    const qrDataUrl = await generateQrDataUrl(url, 400);

    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(x + 2, y + 2, cellW - 4, cellH - 4, 3, 3);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(layout === 'a4-grid' ? 11 : 9);
    doc.setTextColor(15, 23, 42);
    doc.text(restaurantName, x + cellW / 2, y + 10, { align: 'center' });

    doc.setFontSize(layout === 'a4-grid' ? 14 : 11);
    doc.setTextColor(234, 88, 12);
    doc.text(`Table ${table.tableNumber}`, x + cellW / 2, y + 17, { align: 'center' });

    const qrSize = layout === 'a4-grid' ? 48 : 34;
    doc.addImage(qrDataUrl, 'PNG', x + (cellW - qrSize) / 2, y + 20, qrSize, qrSize);

    doc.setFontSize(layout === 'a4-grid' ? 10 : 8);
    doc.setTextColor(15, 23, 42);
    doc.text('Scan to View Menu & Order', x + cellW / 2, y + 24 + qrSize, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${table.floor} • ${table.section} • ${table.capacity} Seats`,
      x + cellW / 2,
      y + 29 + qrSize,
      { align: 'center' }
    );
  }

  const filename =
    tables.length === 1
      ? `Table-${tables[0].tableNumber}-QR.pdf`
      : `Tables-QR-Sheet-${layout}.pdf`;
  doc.save(filename);
}

export function downloadBillPdf(bill: Bill, settings: Partial<RestaurantSettings>): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const cur = settings.currencySymbol || '₹';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(settings.name || 'Saffron & Hearth', 74, 15, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  if (settings.address) {
    doc.text(settings.address, 74, 21, { align: 'center' });
  }
  const contactLine = [
    settings.phone ? `Tel: ${settings.phone}` : '',
    settings.gstNumber ? `GSTIN: ${settings.gstNumber}` : '',
  ]
    .filter(Boolean)
    .join('  |  ');
  if (contactLine) {
    doc.text(contactLine, 74, 26, { align: 'center' });
  }

  doc.line(10, 31, 138, 31);
  doc.setFontSize(9.5);
  doc.text(`Bill #: ${bill.billNumber}`, 10, 38);
  doc.text(`Table: ${bill.tableNumber}`, 138, 38, { align: 'right' });
  doc.text(`Date: ${new Date(bill.createdAt).toLocaleString()}`, 10, 44);
  doc.text(`Status: ${bill.status.toUpperCase()}`, 138, 44, { align: 'right' });
  doc.line(10, 48, 138, 48);

  let y = 55;
  doc.setFont('helvetica', 'bold');
  doc.text('Item', 10, y);
  doc.text('Qty', 92, y, { align: 'right' });
  doc.text('Amount', 138, y, { align: 'right' });
  y += 5;
  doc.setFont('helvetica', 'normal');

  for (const item of bill.items) {
    if (y > 175) {
      doc.addPage();
      y = 18;
    }
    const label = item.name.length > 42 ? item.name.slice(0, 40) + '..' : item.name;
    doc.text(label, 10, y);
    doc.text(String(item.quantity), 92, y, { align: 'right' });
    doc.text(`${cur}${item.lineTotal.toFixed(2)}`, 138, y, { align: 'right' });
    y += 6;
  }

  y += 3;
  doc.line(10, y, 138, y);
  y += 6;
  const addRow = (label: string, val: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, 80, y);
    doc.text(`${cur}${val.toFixed(2)}`, 138, y, { align: 'right' });
    y += 5.5;
  };
  addRow('Subtotal', bill.subtotal);
  addRow(`Tax (${settings.taxRatePercent ?? 5}%)`, bill.taxAmount);
  addRow(`Service Charge (${settings.serviceChargePercent ?? 5}%)`, bill.serviceChargeAmount);
  if (bill.discountAmount > 0) addRow('Discount', -bill.discountAmount);
  addRow('Grand Total', bill.totalAmount, true);
  addRow('Paid', bill.paidAmount);
  addRow('Balance Due', bill.balanceAmount, true);

  doc.save(`${bill.billNumber}-Table-${bill.tableNumber}.pdf`);
}

export function downloadCsvFile(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escape = (val: string | number) => {
    const str = String(val ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadReportPdf(
  title: string,
  subtitle: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 14, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(subtitle, 14, 22);

  let y = 32;
  const colW = (297 - 28) / headers.length;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  headers.forEach((h, i) => doc.text(h, 14 + i * colW, y));
  doc.line(14, y + 2, 283, y + 2);
  y += 8;

  doc.setFont('helvetica', 'normal');
  for (const row of rows) {
    if (y > 192) {
      doc.addPage();
      y = 18;
    }
    row.forEach((cell, i) => {
      const txt = String(cell ?? '').slice(0, 28);
      doc.text(txt, 14 + i * colW, y);
    });
    y += 6.5;
  }

  doc.save(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
}
