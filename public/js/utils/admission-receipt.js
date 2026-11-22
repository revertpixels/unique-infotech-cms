// admission-receipt.js — View model and data builders for Youth admission receipt
// Matching reference-templates/Ui.html.
// Shared by the on-screen HTML sheet and the vector PDF builder.

import { formatDateIN } from './formatter.js?v=1.8.96';

// Format currency as "Rs. 1,000.00"
export function fmtRs(n) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const a = Math.abs(v).toFixed(2);
  const parts = a.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '- Rs.\u00A0' : 'Rs.\u00A0') + parts.join('.');
}

// Masks 12-digit Aadhaar into "XXXX XXXX 1234" (shows only the last 4 digits).
export function maskAadhaar(raw) {
  if (!raw) return '-';
  const clean = String(raw).replace(/\D/g, '');
  if (clean.length < 4) return '-';
  const last4 = clean.slice(-4);
  return `XXXX XXXX ${last4}`;
}

// Converts number to words in Indian numbering system
export function inWords(num) {
  const n = Math.floor(Number(num) || 0);
  if (n === 0) return 'Rupees Zero Only';

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(val) {
    if (val < 20) return a[val];
    const tens = b[Math.floor(val / 10)];
    const units = a[val % 10];
    return units ? tens + ' ' + units : tens;
  }

  function convertThreeDigits(val) {
    let str = '';
    if (val >= 100) {
      str += a[Math.floor(val / 100)] + ' Hundred';
      val %= 100;
      if (val > 0) str += ' ';
    }
    if (val > 0) {
      str += convertTwoDigits(val);
    }
    return str;
  }

  let words = '';
  let rem = n;

  if (rem >= 10000000) {
    const crore = Math.floor(rem / 10000000);
    words += convertTwoDigits(crore) + ' Crore ';
    rem %= 10000000;
  }
  if (rem >= 100000) {
    const lakh = Math.floor(rem / 100000);
    words += convertTwoDigits(lakh) + ' Lakh ';
    rem %= 100000;
  }
  if (rem >= 1000) {
    const thousand = Math.floor(rem / 1000);
    words += convertTwoDigits(thousand) + ' Thousand ';
    rem %= 1000;
  }
  if (rem > 0) {
    words += convertThreeDigits(rem);
  }

  return 'Rupees ' + words.trim() + ' Only';
}

function imageSrc(d) {
  if (!d) return null;
  let data = d.data || d.Data || d.url || d.path || '';
  if (data && !data.startsWith('data:')) {
    const mime = String(d.type || d.mime || 'image/jpeg').toLowerCase();
    data = (mime.includes('png') ? 'data:image/png;base64,' : 'data:image/jpeg;base64,') + data;
  }
  return data || null;
}

export function buildYouthReceiptData({ admission, photo, signature, org, payment, aadhaar, branch, course, session }) {
  const o = org || {};
  const adm = admission || {};
  const br = branch || {};
  const cs = course || {};
  const ss = session || {};
  const pay = payment || {};
  const adh = aadhaar || {};

  const orgName = o.orgName || 'Unique Infotech';
  const isoLine = o.isoLine || o.isoText || 'An ISO 9001:2015 Certified Organisation';
  const orgLogo = o.logo || o.logoUrl || '/assets/images/logo-192.jpg';
  const orgEmail = o.email || 'utpal.goutam@gmail.com';
  const orgPhones = o.phone || o.phones || '9851771893, 9832147650, 8641209375';

  const branchName = (br.name && br.name !== adm.branchId) ? br.name : ((adm.branchName && adm.branchName !== adm.branchId) ? adm.branchName : 'BANKURA ZILLA YOUTH COMPUTER TRAINING CENTRE');
  const branchCode = br.code || adm.branchCode || 'BZYCTC';
  const branchAddress = br.address || 'Kenduadihi, Bankura, West Bengal - 722101';
  const branchPhones = br.phone || br.mobile || '9733518246, 7003624981, 9475036218';

  const receiptNo = adm.receiptNo || pay.receiptNo || '-';
  const receiptDate = adm.admissionDate ? formatDateIN(adm.admissionDate) : (pay.paymentDate ? formatDateIN(pay.paymentDate) : '-');

  const studentName = (adm.name || '-').toUpperCase();
  const guardianName = (adm.guardianName || '-').toUpperCase();
  const dob = adm.dob ? formatDateIN(adm.dob) : '-';
  const gender = adm.gender ? (adm.gender.charAt(0).toUpperCase() + adm.gender.slice(1).toLowerCase()) : '-';
  const phone = adm.phone || '-';
  const altPhone = adm.altPhone || '-';
  const email = adm.email || '-';
  const qualification = adm.qualification || '-';
  const address = adm.address || '-';
  const rawAadhaar = adh.aadhaar || adh.number || adm.aadhaar || '';
  const aadhaarMasked = maskAadhaar(rawAadhaar);
  const studentId = adm.studentId || '-';
  const admissionDate = adm.admissionDate ? formatDateIN(adm.admissionDate) : '-';

  const courseCode = cs.courseCode || cs.code || adm.courseCode || adm.courseId || '-';
  const courseName = cs.name || adm.courseName || '-';
  const courseFullName = courseCode !== '-' && courseName !== '-' ? `${courseCode} - ${courseName}` : (courseName !== '-' ? courseName : courseCode);
  const duration = cs.durationMonths ? `${cs.durationMonths} Months` : (cs.duration ? `${cs.duration} Months` : (adm.duration ? `${adm.duration} Months` : '4 Months'));
  const batchName = adm.batchName || '-';
  const sessionName = adm.sessionName || ss.name || '-';
  const sessionBegins = ss.startDate ? formatDateIN(ss.startDate) : '-';
  const sessionEnds = ss.endDate ? formatDateIN(ss.endDate) : '-';

  // Syllabus / Curriculum modules (from course or reference template defaults)
  let modules = [];
  if (Array.isArray(cs.curriculum) && cs.curriculum.length > 0) {
    modules = cs.curriculum.map(String);
  } else if (Array.isArray(cs.modules) && cs.modules.length > 0) {
    modules = cs.modules.map(String);
  } else {
    modules = [
      'Information Technology Fundamentals',
      'Desktop OS Overview (Windows 10)',
      'Word Processing System (MS Word 2016)',
      'Spreadsheet (MS Excel 2016)',
      'Presentation Maker (PowerPoint 2016)',
      'Database Management System (MS Access 2016)',
      'Mobile OS Overview',
      'Cyber Security Basics'
    ];
  }

  // Fees: dynamic calculation
  const feeSnapshot = adm.feeSnapshot || cs.fees || {};
  const feeSchedule = Array.isArray(adm.feeSchedule) && adm.feeSchedule.length > 0
    ? adm.feeSchedule
    : [];

  const admissionFee = Number(feeSnapshot.admission || 1000);
  const materialFee = Number(feeSnapshot.material || 0);

  // Construct fee structure rows (Page 2)
  // Total course fee = admission fee + sum of all instalments (material fee is NOT part of course fee)
  const feeStructureRows = [];
  feeStructureRows.push({
    head: 'Admission fee',
    due: 'At admission',
    amount: admissionFee
  });
  if (feeSchedule.length > 0) {
    feeSchedule.forEach((it, idx) => {
      const instNo = it.no || (idx + 1);
      const totalInst = feeSchedule.length;
      feeStructureRows.push({
        head: `Instalment ${instNo} of ${totalInst}`,
        due: it.due ? formatDateIN(it.due) : (it.opens ? formatDateIN(it.opens) : '-'),
        amount: Number(it.amount || feeSnapshot.installment || 500)
      });
    });
  } else {
    // Default 4 installments if not explicitly scheduled
    const instAmt = Number(feeSnapshot.installment || 500);
    for (let i = 1; i <= 4; i++) {
      feeStructureRows.push({
        head: `Instalment ${i} of 4`,
        due: `Month ${i + 2}`,
        amount: instAmt
      });
    }
  }

  // Total course fee = admissionFee + sum(instalments) (no material, no exam fee)
  const totalCourseFee = feeStructureRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const feeTotal = totalCourseFee;

  // Paid at admission from payment record or dueAtAdmission
  const dueAt = adm.dueAtAdmission || {};
  const admissionFeePaid = Number(pay.admissionFee ?? dueAt.admission ?? admissionFee);
  const materialFeePaid = Number(pay.materialFee ?? dueAt.material ?? materialFee);
  const instalmentsPaid = Number(pay.instalmentsPaid || 0);

  const receivedAmount = admissionFeePaid + materialFeePaid;
  const balanceDue = Math.max(0, totalCourseFee - admissionFeePaid - instalmentsPaid);

  // Payment received table (Page 2)
  const paymentReceivedRows = [
    { description: 'Admission fee', status: 'Paid', amount: admissionFeePaid }
  ];
  if (materialFeePaid > 0) {
    paymentReceivedRows.push({ description: 'Study material fee', status: 'Paid', amount: materialFeePaid });
  }

  const photoUrl = imageSrc(photo);
  const signatureUrl = imageSrc(signature);

  return {
    orgName,
    isoLine,
    orgLogo,
    orgEmail,
    orgPhones,
    branchName,
    branchCode,
    branchAddress,
    branchPhones,
    receiptNo,
    receiptDate,
    studentName,
    guardianName,
    dob,
    gender,
    phone,
    altPhone,
    email,
    qualification,
    address,
    aadhaarMasked,
    studentId,
    admissionDate,
    courseCode,
    courseName,
    courseFullName,
    duration,
    batchName,
    sessionName,
    sessionBegins,
    sessionEnds,
    modules,
    feeStructureRows,
    feeTotal,
    totalCourseFee,
    paymentReceivedRows,
    receivedAmount,
    amountInWords: inWords(receivedAmount),
    balanceDue,
    balanceDueWords: inWords(balanceDue),
    photoUrl,
    signatureUrl,
    generatedDate: formatDateIN(new Date().toISOString().slice(0, 10))
  };
}

// Backward-compatible alias for existing code
export const getReceiptData = buildYouthReceiptData;
export const fmtMoney = fmtRs;
