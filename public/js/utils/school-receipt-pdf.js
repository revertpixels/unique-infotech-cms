// school-receipt-pdf.js � Vector PDF generator for Unique Kids Admission Receipt
// using pdfmake. Loaded dynamically on demand. Produces real, selectable,
// searchable text with exact 2-page layout matching reference-templates/uk.html.

import { fmtRs } from './school-receipt.js?v=1.8.190';

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
    console.warn('[urlToDataUrl] failed to convert image:', url, e);
    return null;
  }
}

export function buildSchoolReceiptPdfDefinition(d, logoDataUrl) {
  const content = [];

  // ==========================================
  // PAGE 1: STUDENT DETAILS & REGISTRATION
  // ==========================================

  // Header Logo Box
  const logoCell = logoDataUrl
    ? { image: logoDataUrl, width: 44, height: 44, alignment: 'center' }
    : {
        table: {
          widths: [44],
          body: [[{ text: 'UI', fontSize: 18, bold: true, color: WHITE, alignment: 'center', margin: [0, 10, 0, 10] }]]
        },
        layout: 'noBorders',
        fillColor: NAVY
      };

  content.push({
    columns: [
      { width: 48, stack: [logoCell] },
      { width: 10, text: '' },
      {
        width: '*',
        stack: [
          { text: d.orgName || 'Unique Infotech', fontSize: 16, bold: true, color: DEEP, margin: [0, 0, 0, 1] },
          { text: d.isoLine || 'An ISO 9001:2015 Certified Organisation', fontSize: 8.5, bold: true, color: NAVY, margin: [0, 0, 0, 1] },
          { text: d.programLine || 'SCHOOL COMPUTER PROGRAM (UNIQUE KIDS)', fontSize: 7.8, bold: true, color: '#2B2850', margin: [0, 0, 0, 1] },
          {
            text: [
              { text: (d.orgName || 'Unique Infotech') + ': ', bold: true },
              d.orgPhones ? d.orgPhones.join(', ') : '',
              { text: '  |  Email: ', bold: true },
              d.orgEmail || ''
            ],
            fontSize: 7.2,
            color: '#2B2850'
          }
        ]
      }
    ],
    margin: [0, 0, 0, 6]
  });

  // Dual Header Rule (Navy line + Gold line)
  content.push({
    canvas: [
      { type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 2, lineColor: NAVY },
      { type: 'line', x1: 0, y1: 3, x2: 523, y2: 3, lineWidth: 0.75, lineColor: GOLD }
    ],
    margin: [0, 0, 0, 6]
  });

  // Receipt Title & Meta
  content.push({
    text: 'Admission Receipt',
    fontSize: 11.5,
    bold: true,
    color: NAVY,
    margin: [0, 0, 0, 2]
  });
  content.push({
    text: [
      { text: 'Receipt no: ' },
      { text: d.receiptNo || '-', bold: true },
      { text: '  |  Date: ' },
      { text: d.admissionDate || '-', bold: true }
    ],
    fontSize: 8,
    color: INK,
    margin: [0, 0, 0, 6]
  });

  // Photo Cell (Rowspan 7)
  const photoCell = d.photoUrl
    ? {
        rowSpan: 7,
        stack: [
          {
            image: d.photoUrl,
            width: 72,
            height: 88,
            alignment: 'center'
          }
        ],
        alignment: 'center',
        margin: [0, 2, 0, 2]
      }
    : {
        rowSpan: 7,
        table: {
          widths: [76],
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

  // Signature Cell (Rowspan 3)
  const sigCell = d.signatureUrl
    ? {
        rowSpan: 3,
        stack: [
          {
            image: d.signatureUrl,
            width: 76,
            height: 28,
            alignment: 'center'
          },
          { text: "Student's signature", fontSize: 6.5, color: MUTED, alignment: 'center', margin: [0, 2, 0, 0] }
        ],
        alignment: 'center',
        margin: [0, 2, 0, 2]
      }
    : {
        rowSpan: 3,
        table: {
          widths: [76],
          body: [[{ text: 'Signature', fontSize: 7, color: MUTED, alignment: 'center', margin: [0, 8, 0, 8] }]]
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
    return { text, fontSize: 7.5, bold: true, color: INK, fillColor: TINT, margin: [0, 1.5, 0, 1.5] };
  }
  function val(text, isBold = false) {
    return { text: text || '-', fontSize: 7.5, bold: isBold, color: INK, margin: [0, 1.5, 0, 1.5] };
  }

  // Table Body with Aadhaar included in row 4
  const tableBody = [
    [lbl('Student name'), val(d.studentName, true), photoCell],
    [lbl('Parent / Guardian'), val(d.guardianName), {}],
    [lbl('Date of birth'), val(d.dob), {}],
    [lbl('Aadhaar No.'), val(d.aadhaar), {}],
    [lbl('Gender'), val(d.gender), {}],
    [lbl('Mobile number'), val(d.phone), {}],
    [lbl('Alt. mobile number'), val(d.altPhone), {}],
    [lbl('Class / Standard'), val(d.schoolClass), sigCell],
    [lbl('School name'), val(d.schoolName), {}],
    [lbl('Address'), val(d.address), {}],
    [lbl('Admission no'), { colSpan: 2, ...val(d.admissionNo) }, {}],
    [lbl('Student ID'), { colSpan: 2, ...val(d.studentId, true) }, {}],
    [lbl('Admission date'), { colSpan: 2, ...val(d.admissionDate) }, {}],
    [lbl('Level'), { colSpan: 2, ...val(d.level) }, {}],
    [lbl('Batch'), { colSpan: 2, ...val(d.batch) }, {}],
    [lbl('First monthly bill'), { colSpan: 2, ...val(d.firstMonthlyMonthFormatted) }, {}],
    [lbl('Monthly fee due'), { colSpan: 2, ...val('By the 10th of every month') }, {}],
    [lbl('Centre'), { colSpan: 2, ...val(d.centreName) }, {}],
    [lbl('Centre address'), { colSpan: 2, ...val(d.centreAddress) }, {}]
  ];

  content.push({
    table: {
      widths: [100, 335, 88],
      body: tableBody
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5
    },
    margin: [0, 0, 0, 0]
  });

  // ==========================================
  // PAGE 2: FEES, PAYMENT & TERMS
  // ==========================================

  // Mini Header with explicit pageBreak
  content.push({
    pageBreak: 'before',
    columns: [
      {
        width: '*',
        columns: [
          logoDataUrl
            ? { width: 28, stack: [{ image: logoDataUrl, width: 26, height: 26 }] }
            : {
                width: 28,
                table: { widths: [26], body: [[{ text: 'UI', fontSize: 10, bold: true, color: WHITE, alignment: 'center', margin: [0, 4, 0, 4] }]] },
                layout: 'noBorders',
                fillColor: NAVY
              },
          { width: 6, text: '' },
          {
            width: '*',
            stack: [
              { text: d.orgName || 'Unique Infotech', fontSize: 10, bold: true, color: DEEP },
              { text: d.programLine || 'SCHOOL COMPUTER PROGRAM (UNIQUE KIDS)', fontSize: 6.8, color: MUTED }
            ]
          }
        ]
      },
      {
        width: 'auto',
        stack: [
          {
            text: [
              { text: 'Receipt no: ' },
              { text: d.receiptNo || '-', bold: true }
            ],
            fontSize: 7.2,
            alignment: 'right'
          },
          {
            text: [
              { text: 'Student: ' },
              { text: d.studentName || '-', bold: true },
              { text: '  |  ID: ' },
              { text: d.studentId || '-', bold: true }
            ],
            fontSize: 7.2,
            alignment: 'right'
          }
        ]
      }
    ],
    margin: [0, 0, 0, 5]
  });

  // Dual Rule Page 2
  content.push({
    canvas: [
      { type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 2, lineColor: NAVY },
      { type: 'line', x1: 0, y1: 2.5, x2: 523, y2: 2.5, lineWidth: 0.75, lineColor: GOLD }
    ],
    margin: [0, 0, 0, 8]
  });

  // Section 1: Fee structure
  content.push({
    columns: [
      { text: 'Fee structure', fontSize: 9.5, bold: true, color: NAVY },
      { text: (d.level || 'Course') + ' level', fontSize: 7.5, color: MUTED, alignment: 'right' }
    ],
    margin: [0, 0, 0, 3]
  });

  content.push({
    table: {
      widths: ['*', 100, 80],
      body: [
        [
          { text: 'Fee head', bold: true, fillColor: TINT, fontSize: 7.5 },
          { text: 'Due', bold: true, fillColor: TINT, fontSize: 7.5 },
          { text: 'Amount', bold: true, fillColor: TINT, fontSize: 7.5, alignment: 'right' }
        ],
        [
          { text: 'Admission fee (one-time)', fontSize: 7.5 },
          { text: 'At admission', fontSize: 7.5 },
          { text: fmtRs(d.configuredAdmissionFee), fontSize: 7.5, alignment: 'right' }
        ],
        [
          { colSpan: 2, text: 'Payable at admission', bold: true, fillColor: TINT, fontSize: 7.5 },
          {},
          { text: fmtRs(d.configuredAdmissionFee), bold: true, fillColor: TINT, fontSize: 7.5, alignment: 'right' }
        ]
      ]
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length - 1 || i === node.table.body.length ? 1 : 0.5),
      vLineWidth: () => 0,
      hLineColor: (i, node) => (i === 1 || i === node.table.body.length - 1 ? NAVY : LINE),
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5
    },
    margin: [0, 0, 0, 8]
  });

  // Section 2: Payment received at admission
  content.push({
    columns: [
      { text: 'Payment received at admission', fontSize: 9.5, bold: true, color: NAVY },
      { text: 'Date: ' + (d.admissionDate || '-'), fontSize: 7.5, color: MUTED, alignment: 'right' }
    ],
    margin: [0, 0, 0, 3]
  });

  const payRows = [
    [
      { text: 'Description', bold: true, fillColor: TINT, fontSize: 7.5 },
      { text: 'Status', bold: true, fillColor: TINT, fontSize: 7.5 },
      { text: 'Amount', bold: true, fillColor: TINT, fontSize: 7.5, alignment: 'right' }
    ]
  ];

  if (d.paymentMode === 'difference') {
    payRows.push(
      [
        { text: 'Configured admission fee', fontSize: 7.5 },
        { text: 'Payable', fontSize: 7.5, color: NAVY, bold: true },
        { text: fmtRs(d.configuredAdmissionFee), fontSize: 7.5, alignment: 'right' }
      ],
      [
        { text: 'Eligible prior admission payment', fontSize: 7.5 },
        { text: 'Adjusted', fontSize: 7.5, color: MUTED },
        { text: '- ' + fmtRs(d.eligiblePriorAdmissionPayments), fontSize: 7.5, alignment: 'right' }
      ],
      [
        { text: 'Admission fee difference paid', fontSize: 7.5 },
        { text: 'Paid', fontSize: 7.5, color: NAVY, bold: true },
        { text: fmtRs(d.actualAmountReceived), fontSize: 7.5, alignment: 'right' }
      ]
    );
  } else if (d.paymentMode === 'none') {
    payRows.push([
      { text: 'Admission fee (one-time)', fontSize: 7.5 },
      { text: 'No payment (' + (d.noPaymentReasonFormatted || 'Exempt') + ')', fontSize: 7.5, color: '#C2410C' },
      { text: fmtRs(0), fontSize: 7.5, alignment: 'right' }
    ]);
  } else {
    payRows.push([
      { text: 'Admission fee (one-time)', fontSize: 7.5 },
      { text: 'Paid', fontSize: 7.5, color: NAVY, bold: true },
      { text: fmtRs(d.actualAmountReceived), fontSize: 7.5, alignment: 'right' }
    ]);
  }

  content.push({
    table: {
      widths: ['*', 120, 80],
      body: payRows
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5),
      vLineWidth: () => 0,
      hLineColor: (i) => (i === 1 ? NAVY : LINE),
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5
    },
    margin: [0, 0, 0, 6]
  });

  // Total received & Monthly fee box
  content.push({
    table: {
      widths: ['*', '*'],
      body: [
        [
          {
            fillColor: WHITE,
            stack: [
              { text: 'TOTAL RECEIVED', fontSize: 6.8, bold: true, color: MUTED, margin: [0, 0, 0, 1] },
              {
                text: [
                  { text: fmtRs(d.actualAmountReceived), fontSize: 13, bold: true, color: DEEP },
                  { text: '  (' + (d.amountInWords || '') + ')', fontSize: 7.2, color: MUTED }
                ]
              }
            ],
            margin: [8, 5, 8, 5]
          },
          {
            fillColor: NAVY,
            stack: [
              { text: 'MONTHLY FEE', fontSize: 6.8, bold: true, color: '#C5CBE1', margin: [0, 0, 0, 1] },
              {
                text: [
                  { text: fmtRs(d.monthlyFee), fontSize: 13, bold: true, color: WHITE },
                  { text: '  per month, due by the 10th', fontSize: 7.2, color: '#C5CBE1' }
                ]
              }
            ],
            margin: [8, 5, 8, 5]
          }
        ]
      ]
    },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => LINE,
      vLineColor: () => LINE
    },
    margin: [0, 0, 0, 6]
  });

  // Important Notice
  content.push({
    table: {
      widths: ['*'],
      body: [
        [
          {
            fillColor: TINT,
            stack: [
              {
                text: [
                  { text: 'Important - Monthly fee: ', bold: true, color: INK },
                  'The monthly fee is not included in the amount received today. It must be paid on or before the 10th of every month. A late fine of Rs. 1 per day is charged after the 10th. First monthly bill starts from ' +
                    (d.firstMonthlyMonthFormatted || '-') +
                    '.'
                ],
                fontSize: 7.2,
                color: INK,
                lineHeight: 1.25
              }
            ],
            margin: [8, 5, 8, 5]
          }
        ]
      ]
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i) => (i === 0 ? 3 : 0),
      vLineColor: () => NAVY
    },
    margin: [0, 0, 0, 8]
  });

  // Section 3: Terms & conditions
  content.push({
    text: 'Terms & conditions',
    fontSize: 9.5,
    bold: true,
    color: NAVY,
    margin: [0, 0, 0, 3]
  });

  content.push({
    ol: [
      'Eligibility: no prior computer knowledge is required for this programme.',
      'The monthly fee must be paid on or before the 10th of every month. A late fine of Rs. 1 per day will be charged after the 10th.',
      'Fees once paid are not refundable or transferable.',
      'Study material, once issued, is not returnable.',
      'Keep this receipt safe. It is required for all future payments. Please remember your Student ID (' + (d.studentId || '') + '), as it is needed to pay the monthly fee in our system.',
      'This is a computer-generated receipt and is valid with the authorised signature.'
    ],
    fontSize: 7.2,
    color: '#2B2850',
    lineHeight: 1.25,
    margin: [10, 0, 0, 20]
  });

  // Signatures Area (Student's signature + Authorised signatory) � No "Issued by" line
  content.push({
    columns: [
      {
        width: 170,
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 170, y2: 0, lineWidth: 0.75, lineColor: INK }] },
          { text: "Student's signature", fontSize: 7.8, color: MUTED, alignment: 'center', margin: [0, 4, 0, 0] }
        ]
      },
      { width: '*', text: '' },
      {
        width: 170,
        stack: [
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 170, y2: 0, lineWidth: 0.75, lineColor: INK }] },
          { text: 'Authorised signatory', fontSize: 7.8, color: MUTED, alignment: 'center', margin: [0, 4, 0, 0] }
        ]
      }
    ],
    margin: [0, 0, 0, 16]
  });

  // Thank You Note
  content.push({
    text: 'Thank you for choosing Unique Kids. We wish your child a joyful and successful learning journey.',
    fontSize: 7.2,
    color: MUTED,
    alignment: 'center',
    margin: [0, 0, 0, 0]
  });

  // Document Definition
  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [36, 26, 36, 28],
    defaultStyle: {
      font: 'Roboto',
      color: INK
    },
    footer: function (currentPage, pageCount) {
      return {
        margin: [36, 0, 36, 12],
        columns: [
          { text: 'Unique Kids  |  Generated on ' + (d.today || ''), fontSize: 7.2, color: MUTED },
          { text: 'Page ' + currentPage + ' of ' + pageCount, alignment: 'right', fontSize: 7.2, color: MUTED }
        ]
      };
    },
    content
  };
}

export async function downloadSchoolReceiptPdf(data, fileName) {
  const pdfMake = await loadPdfMake();
  if (!pdfMake || !pdfMake.createPdf) {
    throw new Error('pdfMake failed to initialize');
  }

  // Convert logo to dataUrl
  let logoDataUrl = null;
  try {
    logoDataUrl = await urlToDataUrl('/assets/images/logo.jpg');
  } catch (_) { /* fallback to UI initials */ }

  const docDef = buildSchoolReceiptPdfDefinition(data, logoDataUrl);
  pdfMake.createPdf(docDef).download(fileName);
}
