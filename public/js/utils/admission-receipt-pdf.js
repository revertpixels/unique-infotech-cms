// admission-receipt-pdf.js — Vector PDF generator for Youth Admission Receipt
// using pdfmake. Produces real, selectable, searchable text with exact 2-page layout
// matching reference-templates/Ui.html.

import { fmtRs } from './admission-receipt.js?v=1.8.177';

const INK = '#1D1A3A';
const MUTED = '#5B5F85';
const LINE = '#B9BFDC';
const NAVY = '#333B84';
const DEEP = '#291670';
const GOLD = '#151CAA';
const TINT = '#ECEEFA';
const WHITE = '#FFFFFF';

let pdfMakeLoader = null;

export function loadPdfMake() {
  if (typeof window !== 'undefined' && window.pdfMake && window.pdfMake.createPdf) {
    return Promise.resolve(window.pdfMake);
  }
  if (!pdfMakeLoader) {
    pdfMakeLoader = new Promise((resolve, reject) => {
      function loadScript(src, fallbackSrc) {
        return new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = src;
          s.onload = res;
          s.onerror = () => {
            if (fallbackSrc) {
              const fb = document.createElement('script');
              fb.src = fallbackSrc;
              fb.onload = res;
              fb.onerror = rej;
              document.head.appendChild(fb);
            } else {
              rej(new Error('Failed to load ' + src));
            }
          };
          document.head.appendChild(s);
        });
      }

      loadScript(
        'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js',
        '/vendor/pdfmake.min.js'
      )
        .then(() =>
          loadScript(
            'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js',
            '/vendor/vfs_fonts.js'
          )
        )
        .then(() => {
          if (typeof window !== 'undefined' && window.pdfMake) {
            resolve(window.pdfMake);
          } else {
            reject(new Error('pdfMake not found on window'));
          }
        })
        .catch((err) => {
          pdfMakeLoader = null;
          reject(err);
        });
    });
  }
  return pdfMakeLoader;
}

export async function urlToDataUrl(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('[pdf] urlToDataUrl failed for', url, e);
    return null;
  }
}

export async function buildYouthReceiptPdfDefinition(receiptData) {
  const d = receiptData;

  const [logoData, photoData, sigData] = await Promise.all([
    urlToDataUrl(d.orgLogo),
    urlToDataUrl(d.photoUrl),
    urlToDataUrl(d.signatureUrl)
  ]);

  const content = [];

  // ==============================================================
  // PAGE 1: Student Details & Course Syllabus
  // ==============================================================

  // Header
  const logoCell = logoData
    ? { image: logoData, width: 48, height: 48, alignment: 'center' }
    : {
        table: {
          widths: [48],
          body: [
            [
              {
                text: 'UI',
                bold: true,
                fontSize: 18,
                color: WHITE,
                fillColor: NAVY,
                alignment: 'center',
                margin: [0, 12, 0, 12]
              }
            ]
          ]
        },
        layout: 'noBorders'
      };

  content.push({
    columns: [
      { width: 56, stack: [logoCell] },
      {
        width: '*',
        stack: [
          { text: d.orgName, bold: true, fontSize: 18, color: DEEP, margin: [0, 0, 0, 1] },
          { text: d.isoLine, bold: true, fontSize: 8.5, color: NAVY, margin: [0, 0, 0, 2] },
          { text: d.branchName, bold: true, fontSize: 8, color: INK, margin: [0, 0, 0, 2] },
          {
            text: [
              { text: d.orgName + ': ', bold: true, color: INK },
              { text: d.orgPhones + '   |   Email: ' + d.orgEmail + '\n', color: MUTED },
              { text: (d.branchCode || 'Branch') + ': ', bold: true, color: INK },
              { text: d.branchPhones, color: MUTED }
            ],
            fontSize: 7.5,
            lineHeight: 1.2
          }
        ],
        margin: [6, 0, 0, 0]
      }
    ],
    margin: [0, 0, 0, 6]
  });

  // Top header rule (Navy line + Gold line)
  content.push({
    canvas: [
      { type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 2, lineColor: NAVY },
      { type: 'line', x1: 0, y1: 3, x2: 523, y2: 3, lineWidth: 0.8, lineColor: GOLD }
    ],
    margin: [0, 0, 0, 8]
  });

  // Title & Receipt meta
  content.push({
    text: 'ADMISSION RECEIPT',
    bold: true,
    fontSize: 12,
    color: NAVY,
    alignment: 'center',
    letterSpacing: 2,
    margin: [0, 0, 0, 2]
  });
  content.push({
    text: [
      { text: 'Receipt no: ' },
      { text: d.receiptNo || '-', bold: true },
      { text: '   |   Date: ' },
      { text: d.receiptDate || '-', bold: true }
    ],
    fontSize: 8,
    color: MUTED,
    alignment: 'center',
    margin: [0, 0, 0, 8]
  });

  // Photo Cell (RowSpan 7)
  const photoCell = photoData
    ? {
        rowSpan: 7,
        stack: [
          {
            image: photoData,
            width: 72,
            height: 90,
            alignment: 'center'
          }
        ],
        alignment: 'center',
        margin: [0, 2, 0, 2]
      }
    : {
        rowSpan: 7,
        table: {
          widths: [72],
          body: [[{ text: 'Photo', fontSize: 8, color: MUTED, alignment: 'center', margin: [0, 36, 0, 36] }]]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => LINE,
          vLineColor: () => LINE
        },
        alignment: 'center',
        margin: [0, 2, 0, 2]
      };

  // Signature Cell (RowSpan 3)
  const sigCell = sigData
    ? {
        rowSpan: 3,
        stack: [
          {
            image: sigData,
            width: 72,
            height: 24,
            alignment: 'center'
          },
          { text: "Student's signature", fontSize: 6.5, color: MUTED, alignment: 'center', margin: [0, 1, 0, 0] }
        ],
        alignment: 'center',
        margin: [0, 2, 0, 2]
      }
    : {
        rowSpan: 3,
        table: {
          widths: [72],
          body: [
            [
              {
                stack: [
                  { text: 'Signature', fontSize: 7, color: MUTED, alignment: 'center', margin: [0, 6, 0, 0] },
                  { text: "Student's signature", fontSize: 6, color: MUTED, alignment: 'center', margin: [0, 2, 0, 4] }
                ]
              }
            ]
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => LINE,
          vLineColor: () => LINE
        },
        alignment: 'center',
        margin: [0, 2, 0, 2]
      };

  function lbl(text) {
    return { text, fontSize: 7, bold: true, color: INK, fillColor: TINT, margin: [0, 1.2, 0, 1.2] };
  }
  function val(text, isBold = false) {
    return { text: text || '-', fontSize: 7, bold: isBold, color: INK, margin: [0, 1.2, 0, 1.2] };
  }

  // Details Table (Matching reference-templates/Ui.html)
  const detailsTableBody = [
    [lbl('Student name'), val(d.studentName, true), photoCell],
    [lbl('Guardian name'), val(d.guardianName), {}],
    [lbl('Date of birth'), val(d.dob), {}],
    [lbl('Gender'), val(d.gender), {}],
    [lbl('Mobile number'), val(d.phone, true), {}],
    [lbl('Alt. mobile number'), val(d.altPhone), {}],
    [lbl('Email'), val(d.email), {}],

    [lbl('Aadhaar no.'), val(d.aadhaarMasked, true), sigCell],
    [lbl('Qualification'), val(d.qualification), {}],
    [lbl('Address'), val(d.address), {}],

    [lbl('Student ID'), { text: d.studentId, colSpan: 2, fontSize: 7, bold: true, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Admission date'), { text: d.admissionDate, colSpan: 2, fontSize: 7, bold: true, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Course'), { text: d.courseFullName, colSpan: 2, fontSize: 7, bold: true, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Course code'), { text: d.courseCode, colSpan: 2, fontSize: 7, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Duration'), { text: d.duration, colSpan: 2, fontSize: 7, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Batch'), { text: d.batchName, colSpan: 2, fontSize: 7, bold: true, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Session'), { text: d.sessionName, colSpan: 2, fontSize: 7, bold: true, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Session begins'), { text: d.sessionBegins, colSpan: 2, fontSize: 7, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Session ends'), { text: d.sessionEnds, colSpan: 2, fontSize: 7, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Branch'), { text: d.branchName, colSpan: 2, fontSize: 7, bold: true, color: INK, margin: [0, 1.2, 0, 1.2] }, {}],
    [lbl('Branch address'), { text: d.branchAddress, colSpan: 2, fontSize: 7, color: INK, margin: [0, 1.2, 0, 1.2] }, {}]
  ];

  content.push({
    table: {
      widths: [95, 332, 80],
      body: detailsTableBody
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 1.5,
      paddingBottom: () => 1.5
    },
    margin: [0, 0, 0, 10]
  });

  // Course Syllabus (Modules)
  content.push({
    columns: [
      { text: 'Course syllabus', bold: true, fontSize: 9.5, color: NAVY },
      { text: `${d.courseCode} - ${d.duration}`, fontSize: 7.5, color: MUTED, alignment: 'right' }
    ],
    margin: [0, 2, 0, 2]
  });
  content.push({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1.5, lineColor: NAVY }],
    margin: [0, 0, 0, 6]
  });

  // 2-column modules table
  const mods = d.modules || [];
  const half = Math.ceil(mods.length / 2);
  const leftMods = mods.slice(0, half);
  const rightMods = mods.slice(half);

  const modRows = [];
  const maxRows = Math.max(leftMods.length, rightMods.length);
  for (let i = 0; i < maxRows; i++) {
    const lIdx = i + 1;
    const rIdx = i + 1 + half;
    const lText = leftMods[i] || '';
    const rText = rightMods[i] || '';
    modRows.push([
      { text: lText ? `${lIdx}. ` : '', bold: true, fontSize: 7, color: GOLD, width: 14 },
      { text: lText, fontSize: 7, color: INK },
      { text: rText ? `${rIdx}. ` : '', bold: true, fontSize: 7, color: GOLD, width: 14 },
      { text: rText, fontSize: 7, color: INK }
    ]);
  }

  content.push({
    table: {
      widths: [14, 235, 14, 235],
      body: modRows
    },
    layout: {
      hLineWidth: () => 0.4,
      vLineWidth: () => 0,
      hLineColor: () => LINE,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5
    },
    margin: [0, 0, 0, 10]
  });

  // Page 1 Footer
  content.push({
    columns: [
      { text: `${d.orgName}   |   Generated on ${d.generatedDate}`, fontSize: 7, color: MUTED },
      { text: 'Page 1 of 2', fontSize: 7, color: MUTED, alignment: 'right' }
    ],
    margin: [0, 6, 0, 0]
  });

  // ==============================================================
  // PAGE 2: Fee Structure, Payment Received, Terms, Signatures
  // ==============================================================

  content.push({
    pageBreak: 'before',
    columns: [
      {
        width: 36,
        stack: [
          logoData
            ? { image: logoData, width: 30, height: 30 }
            : {
                table: {
                  widths: [30],
                  body: [[{ text: 'UI', bold: true, fontSize: 11, color: WHITE, fillColor: NAVY, alignment: 'center', margin: [0, 6, 0, 6] }]]
                },
                layout: 'noBorders'
              }
        ]
      },
      {
        width: '*',
        stack: [
          { text: d.orgName, bold: true, fontSize: 11, color: NAVY },
          { text: d.branchName, fontSize: 7.5, color: MUTED }
        ],
        margin: [4, 2, 0, 0]
      },
      {
        width: 200,
        stack: [
          {
            text: [
              { text: 'Receipt no: ' },
              { text: d.receiptNo, bold: true, color: INK }
            ],
            fontSize: 7.5,
            color: MUTED,
            alignment: 'right'
          },
          {
            text: [
              { text: 'Student: ' },
              { text: d.studentName, bold: true, color: INK },
              { text: '   |   ID: ' },
              { text: d.studentId, bold: true, color: INK }
            ],
            fontSize: 7.5,
            color: MUTED,
            alignment: 'right'
          }
        ]
      }
    ],
    margin: [0, 0, 0, 4]
  });

  // Top line Page 2
  content.push({
    canvas: [
      { type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1.5, lineColor: NAVY },
      { type: 'line', x1: 0, y1: 2, x2: 523, y2: 2, lineWidth: 0.8, lineColor: GOLD }
    ],
    margin: [0, 0, 0, 8]
  });

  // Section 1: Fee Structure
  content.push({
    text: 'Fee structure',
    bold: true,
    fontSize: 9.5,
    color: NAVY,
    margin: [0, 0, 0, 4]
  });

  const feeTableRows = [
    [
      { text: 'Fee head', bold: true, fontSize: 7.5, color: INK, fillColor: TINT },
      { text: 'Due', bold: true, fontSize: 7.5, color: INK, fillColor: TINT },
      { text: 'Amount', bold: true, fontSize: 7.5, color: INK, alignment: 'right', fillColor: TINT }
    ]
  ];

  (d.feeStructureRows || []).forEach(r => {
    feeTableRows.push([
      { text: r.head, fontSize: 7, color: INK },
      { text: r.due, fontSize: 7, color: INK },
      { text: fmtRs(r.amount), fontSize: 7, color: INK, alignment: 'right' }
    ]);
  });

  // Total Course Fee row
  feeTableRows.push([
    { text: 'Total course fee', colSpan: 2, bold: true, fontSize: 7.5, color: INK, fillColor: TINT },
    {},
    { text: fmtRs(d.totalCourseFee ?? d.feeTotal), bold: true, fontSize: 7.5, color: INK, alignment: 'right', fillColor: TINT }
  ]);

  content.push({
    table: {
      widths: ['*', 120, 100],
      body: feeTableRows
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length - 1 || i === node.table.body.length ? 1 : 0.4),
      vLineWidth: () => 0.4,
      hLineColor: (i, node) => (i === 1 || i === node.table.body.length - 1 ? NAVY : LINE),
      vLineColor: () => LINE,
      paddingTop: () => 2,
      paddingBottom: () => 2
    },
    margin: [0, 0, 0, 10]
  });

  // Section 2: Payment Received at Admission
  content.push({
    columns: [
      { text: 'Payment received at admission', bold: true, fontSize: 9.5, color: NAVY },
      { text: `Date: ${d.admissionDate}`, fontSize: 7.5, color: MUTED, alignment: 'right' }
    ],
    margin: [0, 0, 0, 4]
  });

  const payTableRows = [
    [
      { text: 'Description', bold: true, fontSize: 7.5, color: INK, fillColor: TINT },
      { text: 'Status', bold: true, fontSize: 7.5, color: INK, fillColor: TINT },
      { text: 'Amount', bold: true, fontSize: 7.5, color: INK, alignment: 'right', fillColor: TINT }
    ]
  ];

  (d.paymentReceivedRows || []).forEach(r => {
    payTableRows.push([
      { text: r.description, fontSize: 7, color: INK },
      { text: r.status, fontSize: 7, bold: true, color: NAVY },
      { text: fmtRs(r.amount), fontSize: 7, color: INK, alignment: 'right' }
    ]);
  });

  content.push({
    table: {
      widths: ['*', 90, 100],
      body: payTableRows
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.4),
      vLineWidth: () => 0.4,
      hLineColor: (i) => (i === 1 ? NAVY : LINE),
      vLineColor: () => LINE,
      paddingTop: () => 2,
      paddingBottom: () => 2
    },
    margin: [0, 0, 0, 6]
  });

  // 2-cell box: Total Received & Balance Due
  content.push({
    table: {
      widths: ['50%', '50%'],
      body: [
        [
          {
            fillColor: TINT,
            stack: [
              { text: 'TOTAL RECEIVED', fontSize: 6.5, bold: true, color: MUTED },
              { text: fmtRs(d.receivedAmount), bold: true, fontSize: 10, color: INK, margin: [0, 1, 0, 1] },
              { text: `(${d.amountInWords})`, fontSize: 6.5, color: MUTED }
            ],
            margin: [4, 4, 4, 4]
          },
          {
            fillColor: NAVY,
            stack: [
              { text: 'BALANCE DUE', fontSize: 6.5, bold: true, color: '#C5CBE1' },
              { text: fmtRs(d.balanceDue), bold: true, fontSize: 10, color: WHITE, margin: [0, 1, 0, 1] },
              { text: `(${d.balanceDueWords})`, fontSize: 6.5, color: '#C5CBE1' }
            ],
            margin: [4, 4, 4, 4]
          }
        ]
      ]
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => LINE,
      vLineColor: () => LINE
    },
    margin: [0, 0, 0, 6]
  });

  // Important Note box
  content.push({
    table: {
      widths: ['*'],
      body: [
        [
          {
            fillColor: TINT,
            text: [
              { text: 'Important - Examination fee: ', bold: true, color: INK },
              {
                text: 'The examination fee is not included in the total course fee shown above. It will be charged as per the Government order in force at the time of the examination, and is payable in addition to the balance due.',
                color: INK
              }
            ],
            fontSize: 6.8,
            lineHeight: 1.25,
            margin: [6, 4, 6, 4]
          }
        ]
      ]
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: (i) => (i === 0 ? 3 : 0.5),
      hLineColor: () => LINE,
      vLineColor: (i) => (i === 0 ? NAVY : LINE)
    },
    margin: [0, 0, 0, 10]
  });

  // Section 3: Terms & Conditions
  content.push({
    text: 'Terms & conditions',
    bold: true,
    fontSize: 9.5,
    color: NAVY,
    margin: [0, 0, 0, 3]
  });

  const terms = [
    'Prerequisite: no prior qualification or computer knowledge is required for this course.',
    'Examination: the examination will be held as per notice after completion of the course.',
    'Certification: the certificate is issued only on passing the examination.',
    'Fees once paid are not refundable or transferable.',
    'Instalments must be paid on or before the due date. A late fine of Rs. 1 per day will be charged after the due date.',
    'The examination fee, as notified, must be paid before the student can appear for the examination.',
    `Keep this receipt safe. It is required for all future payments and certificate collection. Please remember your Student ID (${d.studentId}), as it is needed to pay your instalments in our system.`,
    'This is a computer-generated receipt and is valid with the authorised signature.'
  ];

  content.push({
    ol: terms.map(t => ({ text: t, fontSize: 6.8, color: '#2B2850', lineHeight: 1.2, margin: [0, 0.5, 0, 0.5] })),
    margin: [0, 0, 0, 20]
  });

  // Signatures
  content.push({
    columns: [
      {
        width: 180,
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 170, y2: 0, lineWidth: 0.8, lineColor: INK }] },
          { text: "Student's signature", fontSize: 7.5, color: MUTED, alignment: 'center', margin: [0, 3, 0, 0] }
        ]
      },
      { width: '*', text: '' },
      {
        width: 180,
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 170, y2: 0, lineWidth: 0.8, lineColor: INK }] },
          { text: 'Authorised signatory', fontSize: 7.5, color: MUTED, alignment: 'center', margin: [0, 3, 0, 0] }
        ]
      }
    ],
    margin: [0, 10, 0, 8]
  });

  // Note
  content.push({
    text: 'Thank you for choosing Unique Infotech. We wish you success in your course.',
    fontSize: 7,
    color: MUTED,
    alignment: 'center',
    margin: [0, 0, 0, 8]
  });

  // Page 2 Footer
  content.push({
    columns: [
      { text: `${d.orgName}   |   Generated on ${d.generatedDate}`, fontSize: 7, color: MUTED },
      { text: 'Page 2 of 2', fontSize: 7, color: MUTED, alignment: 'right' }
    ],
    margin: [0, 2, 0, 0]
  });

  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [36, 24, 36, 24],
    content,
    defaultStyle: {
      fontSize: 8,
      color: INK
    }
  };
}

export async function downloadYouthReceiptPdf(receiptData) {
  const pdfMake = await loadPdfMake();
  const docDef = await buildYouthReceiptPdfDefinition(receiptData);
  const cleanReceiptNo = String(receiptData.receiptNo || 'Receipt').replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanName = String(receiptData.studentName || 'Student').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Receipt_${cleanReceiptNo}_${cleanName}.pdf`;

  return new Promise((resolve) => {
    pdfMake.createPdf(docDef).download(filename, resolve);
  });
}
