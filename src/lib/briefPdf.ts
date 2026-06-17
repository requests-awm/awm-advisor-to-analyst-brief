import PDFDocument from 'pdfkit';
import { SECTIONS, fieldVisible, TRANSFER_TYPE_FROM_LABEL, type Answers } from './briefSchema.js';

const NAVY = '#0f2f57';
const GOLD = '#d4a017';
const DARK = '#1f2937';
const MUTED = '#6b7280';

type PdfBrief = {
  client_name: string;
  transfer_type: string | null;
  p_code?: string | null;
  answers: Answers;
  created_at?: string;
  submitted_by_name?: string | null;
};

/** Server-side branded PDF handover document for a brief (matches the old Zap output). */
export function buildBriefPdf(brief: PdfBrief): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const margin = 40;
    const contentW = pageW - margin * 2;

    // Header band
    doc.rect(0, 0, pageW, 70).fill(NAVY);
    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(18)
      .text('Ascot Wealth Management', margin, 20, { width: contentW, align: 'center' });
    doc.fillColor('#cbd5e1').font('Helvetica').fontSize(9)
      .text('Transfer Analysis Brief — Adviser to Analyst Handover', margin, 45, { width: contentW, align: 'center' });

    doc.y = 90;
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(15).text(brief.client_name || 'Client brief', margin, doc.y);
    const meta = [
      brief.transfer_type ? `${brief.transfer_type.toUpperCase()} transfer` : null,
      brief.p_code || null,
      brief.created_at ? `Captured ${new Date(brief.created_at).toLocaleString('en-GB')}` : null,
      brief.submitted_by_name ? `by ${brief.submitted_by_name}` : null,
    ].filter(Boolean).join('   ·   ');
    if (meta) doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(meta, { width: contentW });
    doc.moveDown(0.8);

    const answers = brief.answers || {};
    const tt = TRANSFER_TYPE_FROM_LABEL[answers.transfer_type as string];

    for (const section of SECTIONS) {
      if (section.transferType && section.transferType !== tt) continue;
      const fields = section.fields.filter((f) => fieldVisible(f, answers) && String(answers[f.key] ?? '').trim());
      if (!fields.length) continue;

      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.moveDown(0.5);
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text(section.title, { width: contentW });
      doc.moveTo(margin, doc.y + 2).lineTo(pageW - margin, doc.y + 2).strokeColor('#d9e2f2').lineWidth(1).stroke();
      doc.moveDown(0.5);

      for (const f of fields) {
        if (doc.y > doc.page.height - 80) doc.addPage();
        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9).text(f.label, { width: contentW });
        doc.fillColor(DARK).font('Helvetica').fontSize(10).text(String(answers[f.key]), { width: contentW });
        doc.moveDown(0.4);
      }
    }

    doc.end();
  });
}

/** Safe filename for the handover PDF. */
export function pdfFileName(brief: PdfBrief & { asana_task_id?: string | null }): string {
  const safe = (s: string) => String(s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return `Adviser_to_Analyst_Brief_${safe(brief.client_name)}_${safe((brief as any).asana_task_id || '')}.pdf`.replace(/_+\.pdf$/, '.pdf');
}
