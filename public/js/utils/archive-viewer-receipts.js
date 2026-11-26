// Classic-script receipt templates and vector/high-res PDF exporters for the offline archive viewer.
// Reuses exact templates and math from admission-receipt.js, admission-receipt-pdf.js,
// admission-receipt.page.js, and payment-receipt.page.js.
export const ARCHIVE_RECEIPTS_VIEWER_JS = `(function(){
  var INK = '#1D1A3A';
  var MUTED = '#5B5F85';
  var LINE = '#B9BFDC';
  var NAVY = '#333B84';
  var DEEP = '#291670';
  var GOLD = '#151CAA';
  var TINT = '#ECEEFA';
  var WHITE = '#FFFFFF';

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function fmtRs(n) {
    var v = Number(n) || 0;
    var neg = v < 0;
    var a = Math.abs(v).toFixed(2);
    var parts = a.split('.');
    parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    return (neg ? '- Rs.\\u00A0' : 'Rs.\\u00A0') + parts.join('.');
  }

  function fmtMoney(num) {
    var n = Number(num || 0);
    return 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDateIN(iso) {
    if (!iso) return '-';
    var str = String(iso).slice(0, 10);
    var p = str.split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0]) || isNaN(p[1]) || isNaN(p[2])) return String(iso);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return p[2] + ' ' + (months[p[1] - 1] || p[1]) + ' ' + p[0];
  }

  function fmtDatePad(iso) {
    if (!iso) return '-';
    var str = String(iso).slice(0, 10);
    var p = str.split('-');
    if (p.length !== 3) return String(iso);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var d = p[2].length === 1 ? '0' + p[2] : p[2];
    return d + ' ' + (months[Number(p[1]) - 1] || p[1]) + ' ' + p[0];
  }

  function inWords(num) {
    var n = Math.floor(Number(num) || 0);
    if (n === 0) return 'Rupees Zero Only';
    var a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
      'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function two(val) { if (val < 20) return a[val]; var t = b[Math.floor(val / 10)], u = a[val % 10]; return u ? t + ' ' + u : t; }
    function three(val) { var s = ''; if (val >= 100) { s += a[Math.floor(val / 100)] + ' Hundred'; val %= 100; if (val > 0) s += ' '; } if (val > 0) s += two(val); return s; }
    var words = '', rem = n;
    if (rem >= 10000000) { words += two(Math.floor(rem / 10000000)) + ' Crore '; rem %= 10000000; }
    if (rem >= 100000) { words += two(Math.floor(rem / 100000)) + ' Lakh '; rem %= 100000; }
    if (rem >= 1000) { words += two(Math.floor(rem / 1000)) + ' Thousand '; rem %= 1000; }
    if (rem > 0) words += three(rem);
    return 'Rupees ' + words.trim() + ' Only';
  }

  function joinPhones(val, fb) {
    if (Array.isArray(val) && val.length) return val.join(', ');
    if (typeof val === 'string' && val.trim()) return val.trim();
    return fb || '-';
  }

  function courseFeeOf(feesObj) {
    var f = feesObj || {};
    var instAmt = Number(f.installment != null ? f.installment : (f.feeInstallment || 500));
    var instCount = Number(f.installmentCount != null ? f.installmentCount : (f.feeInstallmentCount || 4));
    var admAmt = Number(f.admission != null ? f.admission : (f.feeAdmission != null ? f.feeAdmission : 1000));
    return Number(f.totalCourseFee != null ? f.totalCourseFee : (admAmt + instAmt * instCount));
  }

  function discountOf(feesObj) {
    var f = feesObj || {};
    var std = courseFeeOf(f);
    var full = Number(f.full || f.fullPayment || 0);
    if (!full || full >= std) return { rs: 0, pct: 0 };
    var rs = std - full;
    return { rs: rs, pct: std > 0 ? Math.round((rs / std) * 100) : 0 };
  }

  function isInstallmentPaid(item, allPayments, student) {
    var no = Number(item.no != null ? item.no : item.installmentNo);
    if (student && Array.isArray(student.paidInstallments) && student.paidInstallments.indexOf(no) >= 0) return true;
    for (var i = 0; i < (allPayments || []).length; i++) {
      var p = allPayments[i];
      var t = String(p.type || '').toUpperCase();
      if ((t === 'IN' || t === 'INST') && Number(p.installmentNo) === no) return true;
    }
    return Boolean(item.paid);
  }

  function installmentCourseFee(student) {
    var sched = (student && Array.isArray(student.feeSchedule) && student.feeSchedule.length) ? student.feeSchedule : [];
    if (sched.length) {
      var sum = 0;
      for (var i = 0; i < sched.length; i++) sum += Number(sched[i].amount || 0);
      return sum;
    }
    var cnt = Number(student && student.feeInstallmentCount ? student.feeInstallmentCount : 4);
    var amt = Number(student && student.feeInstallment != null ? student.feeInstallment : 500);
    return cnt * amt;
  }

  function installmentBalanceDue(student, allPayments) {
    var sched = (student && Array.isArray(student.feeSchedule) && student.feeSchedule.length) ? student.feeSchedule : [];
    var due = 0;
    for (var i = 0; i < sched.length; i++) {
      if (!isInstallmentPaid(sched[i], allPayments, student)) {
        due += Number(sched[i].amount || 0);
      }
    }
    return Math.max(0, due);
  }

  function buildAdmissionReceiptModel(student, data) {
    var base = student._admissionReceiptModel;
    var o = data.org || {};
    var ss = data.session || {};
    var br = (data.branchesById && data.branchesById[student.branchId]) || {};
    var cs = (data.coursesById && data.coursesById[student.courseId]) || {};
    var docsList = (data.docsByStudent && data.docsByStudent[student.id]) || [];

    var photoRel = '';
    var sigRel = '';
    for (var i = 0; i < docsList.length; i++) {
      if (docsList[i].key === 'photo' && docsList[i].path) photoRel = docsList[i].path;
      if (docsList[i].key === 'signature' && docsList[i].path) sigRel = docsList[i].path;
    }

    if (base) {
      var cloned = JSON.parse(JSON.stringify(base));
      cloned.orgLogoRel = data.orgLogoPath || '';
      cloned.photoRel = photoRel;
      cloned.signatureRel = sigRel;
      return cloned;
    }

    var orgName = o.orgName || 'Unique Infotech';
    var isoLine = o.isoLine || o.isoText || o.tagline || 'An ISO 9001:2015 Certified Organisation';
    var orgEmail = o.email || 'utpal.goutam@gmail.com';
    var orgPhones = joinPhones(o.phone || o.phones, '9851771893, 9832147650, 8641209375');
    var branchName = (br.name && br.name !== student.branchId) ? br.name : ((student.branchName && student.branchName !== student.branchId) ? student.branchName : 'BANKURA ZILLA YOUTH COMPUTER TRAINING CENTRE');
    var branchCode = br.code || br.branchCode || student.branchCode || 'BZYCTC';
    var branchAddress = br.address || 'Kenduadihi, Bankura, West Bengal - 722101';
    var branchPhones = joinPhones(br.phone || br.phones || br.mobile, '9733518246, 7003624981, 9475036218');

    var stPays = (data.paymentsByStudent && data.paymentsByStudent[student.id]) || [];
    var pay = stPays[0] || {};
    var receiptNo = student.admissionReceiptNo || student.receiptNo || student.fullReceiptNo || pay.receiptNo || '-';
    var receiptDate = student.admissionDate ? fmtDateIN(student.admissionDate) : '-';
    var modules = Array.isArray(cs.curriculum) && cs.curriculum.length ? cs.curriculum.map(String)
      : (Array.isArray(cs.modules) && cs.modules.length ? cs.modules.map(String) : [
        'Information Technology Fundamentals', 'Desktop OS Overview (Windows 10)',
        'Word Processing System (MS Word 2016)', 'Spreadsheet (MS Excel 2016)',
        'Presentation Maker (PowerPoint 2016)', 'Database Management System (MS Access 2016)',
        'Mobile OS Overview', 'Cyber Security Basics'
      ]);

    var feeSnap = student.feeSnapshot || cs.fees || {};
    var admFee = Number(feeSnap.admission != null ? feeSnap.admission : 1000);
    var matFee = Number(feeSnap.material || 0);
    var feeSchedule = (Array.isArray(student.feeSchedule) && student.feeSchedule.length) ? student.feeSchedule : (data.defaultSchedule || []);
    var dueAt = student.dueAtAdmission || {};
    var isFull = student.paymentPlan === 'full';
    var feeStructureRows = [];
    var paymentReceivedRows = [];
    var totalCourseFee = 0, receivedAmount = 0, balanceDue = 0;

    if (isFull) {
      var stdFee = courseFeeOf(feeSnap);
      var fullAmt = Number(student.fullPaymentAmount || dueAt.full || pay.amount || stdFee);
      var disc = discountOf(feeSnap);
      feeStructureRows.push({ head: 'Standard course fee', due: 'Regular package', amount: stdFee });
      if (disc.rs > 0) {
        feeStructureRows.push({ head: 'Full-payment discount', due: '- Rs ' + disc.rs.toLocaleString('en-IN') + ' (' + disc.pct + '%)', amount: -disc.rs });
      }
      totalCourseFee = fullAmt;
      var matPaidF = Number(pay.materialFee != null ? pay.materialFee : (dueAt.material != null ? dueAt.material : matFee));
      receivedAmount = fullAmt + matPaidF;
      balanceDue = 0;
      paymentReceivedRows.push({ description: 'Course fee (paid in full)', status: 'Paid', amount: fullAmt });
      if (matPaidF > 0) paymentReceivedRows.push({ description: 'Study material', status: 'Paid', amount: matPaidF });
    } else {
      feeStructureRows.push({ head: 'Admission fee', due: 'At admission', amount: admFee });
      if (feeSchedule.length) {
        for (var k = 0; k < feeSchedule.length; k++) {
          var it = feeSchedule[k];
          var no = it.no || (k + 1);
          feeStructureRows.push({
            head: 'Instalment ' + no + ' of ' + feeSchedule.length,
            due: it.due ? fmtDateIN(it.due) : (it.opens ? fmtDateIN(it.opens) : '-'),
            amount: Number(it.amount != null ? it.amount : (feeSnap.installment || 500))
          });
        }
      }
      for (var r = 0; r < feeStructureRows.length; r++) totalCourseFee += Number(feeStructureRows[r].amount || 0);
      var admPaid = Number(pay.admissionFee != null ? pay.admissionFee : (dueAt.admission != null ? dueAt.admission : admFee));
      var matPaid = Number(pay.materialFee != null ? pay.materialFee : (dueAt.material != null ? dueAt.material : matFee));
      var instPaid = Number(pay.instalmentsPaid || 0);
      receivedAmount = admPaid + matPaid;
      balanceDue = Math.max(0, totalCourseFee - admPaid - instPaid);
      paymentReceivedRows.push({ description: 'Admission fee', status: 'Paid', amount: admPaid });
      if (matPaid > 0) paymentReceivedRows.push({ description: 'Study material fee', status: 'Paid', amount: matPaid });
    }

    var courseCode = cs.courseCode || cs.code || student.courseCode || student.courseId || '-';
    var courseName = cs.name || student.courseName || '-';
    var courseFullName = (courseCode !== '-' && courseName !== '-') ? (courseCode + ' - ' + courseName) : (courseName !== '-' ? courseName : courseCode);
    var duration = cs.durationMonths ? (cs.durationMonths + ' Months') : (cs.duration ? (cs.duration + ' Months') : (student.duration ? (student.duration + ' Months') : '4 Months'));

    return {
      orgName: orgName,
      isoLine: isoLine,
      orgEmail: orgEmail,
      orgPhones: orgPhones,
      branchName: branchName,
      branchCode: branchCode,
      branchAddress: branchAddress,
      branchPhones: branchPhones,
      receiptNo: receiptNo,
      receiptDate: receiptDate,
      studentName: String(student.name || '-').toUpperCase(),
      guardianName: String(student.guardianName || student.fatherName || '-').toUpperCase(),
      dob: student.dob ? fmtDateIN(student.dob) : '-',
      gender: student.gender ? (student.gender.charAt(0).toUpperCase() + student.gender.slice(1).toLowerCase()) : '-',
      phone: student.phone || '-',
      altPhone: student.altPhone || '-',
      email: student.email || '-',
      qualification: student.qualification || '-',
      address: student.address || '-',
      aadhaarMasked: student.aadhaarMasked || '-',
      studentId: student.studentId || '-',
      admissionDate: student.admissionDate ? fmtDateIN(student.admissionDate) : '-',
      courseCode: courseCode,
      courseName: courseName,
      courseFullName: courseFullName,
      duration: duration,
      batchName: student.batchName || '-',
      sessionName: student.sessionName || ss.name || '-',
      sessionBegins: ss.startDate ? fmtDateIN(ss.startDate) : '-',
      sessionEnds: ss.endDate ? fmtDateIN(ss.endDate) : '-',
      modules: modules,
      feeStructureRows: feeStructureRows,
      feeTotal: totalCourseFee,
      totalCourseFee: totalCourseFee,
      paymentReceivedRows: paymentReceivedRows,
      receivedAmount: receivedAmount,
      amountInWords: inWords(receivedAmount),
      balanceDue: balanceDue,
      balanceDueWords: inWords(balanceDue),
      generatedDate: fmtDateIN((data.meta && data.meta.asOfDate) || ss.endDate || ss.startDate || ''),
      orgLogoRel: data.orgLogoPath || '',
      photoRel: photoRel,
      signatureRel: sigRel
    };
  }

  function buildAdmissionReceiptHtml(student, data) {
    var d = buildAdmissionReceiptModel(student, data);

    var logoHtml = d.orgLogoRel
      ? '<div class="logo img"><img data-arc-src="' + esc(d.orgLogoRel) + '" alt="' + esc(d.orgName) + ' logo"></div>'
      : '<div class="logo"><span>UI</span></div>';

    var photoHtml = d.photoRel
      ? '<div class="photo"><img data-arc-src="' + esc(d.photoRel) + '" alt="Student photo"></div>'
      : '<div class="photo"><span>Photo</span></div>';

    var sigHtml = d.signatureRel
      ? '<div class="sig"><img data-arc-src="' + esc(d.signatureRel) + '" alt="Student signature"></div>'
      : '<div class="sig"><span style="color:var(--muted);font-size:11px">Signature</span></div>';

    var modsHtml = (d.modules || []).map(function(m, idx){
      return '<div><i>' + (idx + 1) + '</i>' + esc(m) + '</div>';
    }).join('');

    var feeRowsHtml = (d.feeStructureRows || []).map(function(r){
      return '<tr><td>' + esc(r.head) + '</td><td>' + esc(r.due) + '</td><td>' + fmtRs(r.amount) + '</td></tr>';
    }).join('');

    var payRowsHtml = (d.paymentReceivedRows || []).map(function(r){
      return '<tr><td>' + esc(r.description) + '</td><td><span class="pill">' + esc(r.status) + '</span></td><td>' + fmtRs(r.amount) + '</td></tr>';
    }).join('');

    return '' +
      '<div class="ar-page">' +
        '<div class="hd">' +
          logoHtml +
          '<div>' +
            '<h1>' + esc(d.orgName) + '</h1>' +
            '<div class="iso">' + esc(d.isoLine) + '</div>' +
            '<div class="br">' + esc(d.branchName) + '</div>' +
            '<div class="ct"><b>' + esc(d.orgName) + ':</b> ' + esc(d.orgPhones) + ' &nbsp;|&nbsp; <b>Email:</b> ' + esc(d.orgEmail) + '<br><b>' + esc(d.branchCode) + ':</b> ' + esc(d.branchPhones) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="title">Admission Receipt</div>' +
        '<div class="rno">Receipt no: ' + esc(d.receiptNo) + ' &nbsp;|&nbsp; Date: ' + esc(d.receiptDate) + '</div>' +
        '<table class="d">' +
          '<tr><th>Student name</th><td>' + esc(d.studentName) + '</td><td class="pc" rowspan="6">' + photoHtml + '</td></tr>' +
          '<tr><th>Guardian name</th><td>' + esc(d.guardianName) + '</td></tr>' +
          '<tr><th>Date of birth</th><td>' + esc(d.dob) + '</td></tr>' +
          '<tr><th>Gender</th><td>' + esc(d.gender) + '</td></tr>' +
          '<tr><th>Mobile number</th><td>' + esc(d.phone) + '</td></tr>' +
          '<tr><th>Alt. mobile number</th><td>' + esc(d.altPhone) + '</td></tr>' +
          '<tr><th>Email</th><td>' + esc(d.email) + '</td><td class="pc" rowspan="4">' + sigHtml + '<div class="cap">Student&#39;s signature</div></td></tr>' +
          '<tr><th>Qualification</th><td>' + esc(d.qualification) + '</td></tr>' +
          '<tr><th>Address</th><td>' + esc(d.address) + '</td></tr>' +
          '<tr><th>Aadhaar No.</th><td>' + esc(d.aadhaarMasked) + '</td></tr>' +
          '<tr><th>Admission no</th><td colspan="2">' + esc(d.studentId) + '</td></tr>' +
          '<tr><th>Student ID</th><td colspan="2">' + esc(d.studentId) + '</td></tr>' +
          '<tr><th>Admission date</th><td colspan="2">' + esc(d.admissionDate) + '</td></tr>' +
          '<tr><th>Course</th><td colspan="2">' + esc(d.courseFullName) + '</td></tr>' +
          '<tr><th>Course code</th><td colspan="2">' + esc(d.courseCode) + '</td></tr>' +
          '<tr><th>Duration</th><td colspan="2">' + esc(d.duration) + '</td></tr>' +
          '<tr><th>Batch</th><td colspan="2">' + esc(d.batchName) + '</td></tr>' +
          '<tr><th>Session</th><td colspan="2">' + esc(d.sessionName) + '</td></tr>' +
          '<tr><th>Session begins</th><td colspan="2">' + esc(d.sessionBegins) + '</td></tr>' +
          '<tr><th>Session ends</th><td colspan="2">' + esc(d.sessionEnds) + '</td></tr>' +
          '<tr><th>Branch</th><td colspan="2">' + esc(d.branchName) + '</td></tr>' +
          '<tr><th>Branch address</th><td colspan="2">' + esc(d.branchAddress) + '</td></tr>' +
        '</table>' +
        '<div class="sec sp1">' +
          '<h4><span class="ht"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>Course syllabus</span><small>' + esc(d.courseCode) + ' - ' + esc(d.duration) + '</small></h4>' +
          '<div class="mods">' + modsHtml + '</div>' +
        '</div>' +
        '<div class="ft"><span>' + esc(d.orgName) + ' &nbsp;|&nbsp; Generated on ' + esc(d.generatedDate) + '</span><span>Page 1 of 2</span></div>' +
      '</div>' +
      '<div class="ar-page">' +
        '<div class="mini">' +
          '<div class="l">' + logoHtml + '<div><b>' + esc(d.orgName) + '</b><span>' + esc(d.branchName) + '</span></div></div>' +
          '<div class="r">Receipt no: <b>' + esc(d.receiptNo) + '</b><br>Student: <b>' + esc(d.studentName) + '</b> &nbsp;|&nbsp; ID: <b>' + esc(d.studentId) + '</b></div>' +
        '</div>' +
        '<div class="sec"><h4><span class="ht"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></svg>Fee structure</span></h4>' +
          '<table class="fe"><thead><tr><th>Fee head</th><th>Due</th><th>Amount</th></tr></thead><tbody>' + feeRowsHtml + '</tbody>' +
          '<tfoot><tr><td colspan="2">Total course fee</td><td>' + fmtRs(d.totalCourseFee != null ? d.totalCourseFee : d.feeTotal) + '</td></tr></tfoot></table>' +
        '</div>' +
        '<div class="sec sp2"><h4><span class="ht"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>Payment received at admission</span><small>Date: ' + esc(d.receiptDate) + '</small></h4>' +
          '<table class="fe"><thead><tr><th>Description</th><th>Status</th><th>Amount</th></tr></thead><tbody>' + payRowsHtml + '</tbody></table>' +
          '<div class="pbox">' +
            '<div class="pcell"><em>Total received</em><b>' + fmtRs(d.receivedAmount) + '</b><span class="w">(' + esc(d.amountInWords) + ')</span></div>' +
            '<div class="pcell bal"><em>Balance due</em><b>' + fmtRs(d.balanceDue) + '</b><span class="w">(' + esc(d.balanceDueWords) + ')</span></div>' +
          '</div>' +
          '<div class="imp"><div><b>Important - Examination fee:</b> The examination fee is not included in the total course fee shown above. It will be charged as per the Government order in force at the time of the examination, and is payable in addition to the balance due.</div></div>' +
        '</div>' +
        '<div class="sec sp2"><h4><span class="ht"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/></svg>Terms &amp; conditions</span></h4>' +
          '<ol class="terms">' +
            '<li>Prerequisite: no prior qualification or computer knowledge is required for this course.</li>' +
            '<li>Examination: the examination will be held as per notice after completion of the course.</li>' +
            '<li>Certification: the certificate is issued only on passing the examination.</li>' +
            '<li>Fees once paid are not refundable or transferable.</li>' +
            '<li>Instalments must be paid on or before the due date. A late fine of Rs. 1 per day will be charged after the due date.</li>' +
            '<li>The examination fee, as notified, must be paid before the student can appear for the examination.</li>' +
            '<li>Keep this receipt safe. It is required for all future payments and certificate collection. Please remember your Student ID (' + esc(d.studentId) + '), as it is needed to pay your instalments in our system.</li>' +
            '<li>This is a computer-generated receipt and is valid with the authorised signature.</li>' +
          '</ol>' +
        '</div>' +
        '<div class="sigs"><div>Student&#39;s signature</div><div>Authorised signatory</div></div>' +
        '<div class="note">Thank you for choosing Unique Infotech. We wish you success in your course.</div>' +
        '<div class="ft"><span>' + esc(d.orgName) + ' &nbsp;|&nbsp; Generated on ' + esc(d.generatedDate) + '</span><span>Page 2 of 2</span></div>' +
      '</div>';
  }

  function buildPaymentReceiptHtml(entry, student, data) {
    var o = data.org || {};
    var branch = (data.branchesById && data.branchesById[student.branchId]) || {};
    var allPayments = (data.paymentsByStudent && data.paymentsByStudent[student.id]) || [];

    var rawPay = null;
    for (var i = 0; i < allPayments.length; i++) {
      if (allPayments[i].id === entry.id || (entry.receiptNo && allPayments[i].receiptNo === entry.receiptNo && String(allPayments[i].type||'').toUpperCase() === String(entry.type||'').toUpperCase())) {
        rawPay = allPayments[i];
        break;
      }
    }
    var payment = rawPay || entry;

    var orgName = o.orgName || 'Unique Infotech';
    var orgSub = o.orgSubtitle || o.isoLine || o.isoText || 'An ISO 9001:2015 Certified Organisation';
    var branchName = branch.name || student.branchName || 'BANKURA ZILLA YOUTH COMPUTER TRAINING CENTRE';
    var orgPhones = joinPhones(o.phones || o.phone, '9851771893, 9832147650, 8641209375');
    var orgEmail = o.email || 'utpal.goutam@gmail.com';
    var branchPhones = joinPhones(branch.phone || branch.phones, '9733518246, 7003624981, 9475036218');

    var payType = String(payment.type || entry.type || 'IN').toUpperCase();
    var isExam = payType === 'EX';
    var isInstallment = payType === 'IN' || payType === 'INST';
    var instNo = Number(payment.installmentNo || entry.installmentNo || 1);

    var totalCourseFee = isExam ? Number(payment.amount || entry.amount || 0)
      : (student._installmentCourseFee != null ? Number(student._installmentCourseFee) : installmentCourseFee(student));
    var paidAmount = Number(payment.amount != null ? payment.amount : (entry.amount || 0));
    var lateFee = Number(payment.lateFee != null ? payment.lateFee : (payment.lateFeeAmount != null ? payment.lateFeeAmount : (entry.lateFeePaid || 0)));
    var isWaived = Boolean(payment.waived || entry.isPureWaiver || Number(entry.lateFeeWaived || 0) > 0);
    var totalReceived = Number(payment.total != null ? payment.total : (entry.totalReceived != null ? entry.totalReceived : (paidAmount + (isWaived ? 0 : lateFee))));
    var balanceDue = isExam ? 0 : (student._installmentBalanceDue != null ? Number(student._installmentBalanceDue) : installmentBalanceDue(student, allPayments));

    var pDateIso = payment.paidOn || payment.date || entry.date || '';
    var pDateStr = fmtDatePad(pDateIso);
    var rNo = payment.receiptNo || entry.receiptNo || 'RCPT-PREVIEW';

    var amountWords = (lateFee > 0 && !isWaived)
      ? ('(Instalment Rs. ' + paidAmount + ' + late fine Rs. ' + lateFee + ')')
      : ('(' + inWords(totalReceived) + ')');

    var sched = (Array.isArray(student.feeSchedule) && student.feeSchedule.length) ? student.feeSchedule : (data.defaultSchedule || []);
    var nextDueHint = '';
    if (isInstallment) {
      var nextItem = null;
      for (var k = 0; k < sched.length; k++) {
        if (Number(sched[k].no != null ? sched[k].no : sched[k].installmentNo) === instNo + 1) {
          nextItem = sched[k];
          break;
        }
      }
      if (nextItem && balanceDue > 0) {
        nextDueHint = 'Next: Rs. ' + Number(nextItem.amount || 0) + ' on ' + fmtDatePad(nextItem.due);
      }
    }

    var titleText = isExam ? 'Board Examination Fee Receipt' : 'Monthly Fee Payment Receipt';

    var docsList = (data.docsByStudent && data.docsByStudent[student.id]) || [];
    var photoPath = '';
    for (var d = 0; d < docsList.length; d++) {
      if (docsList[d].key === 'photo' && docsList[d].path) { photoPath = docsList[d].path; break; }
    }

    var ledgerRows = '';
    if (isExam) {
      ledgerRows = '<tr class="cur"><td>Board Examination fee (this receipt)</td><td>Exam registration</td><td><span class="mpr-pill">Paid</span></td><td>' + fmtMoney(paidAmount) + '</td></tr>';
    } else {
      ledgerRows = sched.map(function(it){
        var itNo = Number(it.no != null ? it.no : it.installmentNo);
        var isCur = isInstallment && itNo === instNo;
        var paid = isInstallmentPaid(it, allPayments, student);
        return '<tr class="' + (isCur ? 'cur' : '') + '">' +
          '<td>Instalment ' + itNo + ' of ' + (sched.length || 4) + (isCur ? ' (this receipt)' : '') + '</td>' +
          '<td>' + fmtDatePad(it.due) + '</td>' +
          '<td><span class="mpr-pill ' + (paid ? '' : 'due') + '">' + (paid ? 'Paid' : 'Due') + '</span></td>' +
          '<td>' + fmtMoney(it.amount || 0) + '</td>' +
        '</tr>';
      }).join('');
    }

    var lateCellTxt = isWaived
      ? ('Waived (' + esc(payment.waivedByDesignation || payment.recordedByDesignation || entry.recordedByDesignation || 'Staff') + ')')
      : (lateFee > 0 ? fmtMoney(lateFee) : 'Rs. 0.00');

    var curDueDate = '';
    if (isInstallment) {
      for (var c = 0; c < sched.length; c++) {
        if (Number(sched[c].no != null ? sched[c].no : sched[c].installmentNo) === instNo) {
          curDueDate = sched[c].due || '';
          break;
        }
      }
    }

    return '' +
      '<div class="mpr-hd">' +
        (data.orgLogoPath ? '<div class="mpr-logo img"><img data-arc-src="' + esc(data.orgLogoPath) + '" alt="Logo"></div>' : '<div class="mpr-logo"><span>UI</span></div>') +
        '<div>' +
          '<h1>' + esc(orgName) + '</h1>' +
          '<div class="mpr-iso">' + esc(orgSub) + '</div>' +
          '<div class="mpr-br">' + esc(branchName) + '</div>' +
          '<div class="mpr-ct"><b>' + esc(orgName) + ':</b> ' + esc(orgPhones) + ' &nbsp;|&nbsp; <b>Email:</b> ' + esc(orgEmail) + '<br><b>Branch Contact:</b> ' + esc(branchPhones) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="mpr-title">' + esc(titleText) + '</div>' +
      '<div class="mpr-rno">Receipt no: <strong>' + esc(rNo) + '</strong> &nbsp;|&nbsp; Date: <strong>' + esc(pDateStr) + '</strong></div>' +
      '<table class="mpr-d">' +
        '<tr><th>Student name</th><td><strong>' + esc(student.name || '-') + '</strong></td>' +
          '<td class="mpr-pc" rowspan="5"><div class="mpr-photo">' + (photoPath ? '<img data-arc-src="' + esc(photoPath) + '" alt="Student photo">' : '<span>Photo</span>') + '</div></td></tr>' +
        '<tr><th>Guardian name</th><td>' + esc(student.guardianName || student.fatherName || '-') + '</td></tr>' +
        '<tr><th>Student ID</th><td><strong>' + esc(student.studentId || '-') + '</strong></td></tr>' +
        '<tr><th>Course</th><td>' + esc(student.courseName || student.courseCode || '-') + '</td></tr>' +
        '<tr><th>Batch / Session</th><td>' + esc(student.batchName || 'Standard') + ' &nbsp;|&nbsp; ' + esc(student.sessionName || '-') + '</td></tr>' +
      '</table>' +
      '<div class="mpr-sec">' +
        '<h4><span class="mpr-ht"><svg class="mpr-ic" viewBox="0 0 24 24"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>Payment details</span></h4>' +
        '<div class="mpr-meta">' +
          '<div><em>Paid for</em><b>' + (isExam ? 'Board Examination Fee' : ('Instalment ' + instNo + ' of ' + (sched.length || 4))) + '</b></div>' +
          '<div><em>Due date</em><b>' + (isInstallment ? fmtDatePad(curDueDate) : 'At Exam Registration') + '</b></div>' +
          '<div><em>Date of payment</em><b>' + esc(pDateStr) + '</b></div>' +
          '<div><em>Late fine</em><b>' + lateCellTxt + '</b></div>' +
        '</div>' +
        '<div class="mpr-pbox">' +
          '<div class="mpr-pcell"><em>Amount received</em><b>' + fmtMoney(totalReceived) + '</b><span class="w">' + esc(amountWords) + '</span></div>' +
          '<div class="mpr-pcell bal"><em>Balance due</em><b>' + fmtMoney(balanceDue) + '</b>' + (nextDueHint ? '<span class="w">' + esc(nextDueHint) + '</span>' : '') + '</div>' +
        '</div>' +
        (!isExam ? '<div class="mpr-imp"><b>Important - Examination fee:</b> The examination fee is not included in the total course fee shown above. It will be charged as per the Government order in force at the time of the examination, and is payable in addition to the balance due.</div>' : '') +
      '</div>' +
      '<div class="mpr-sec">' +
        '<h4><span class="mpr-ht"><svg class="mpr-ic" viewBox="0 0 24 24"><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></svg>Fee ledger</span>' +
          '<small>' + (isExam ? ('Examination fee ' + fmtMoney(paidAmount)) : ('Course fee (installments) ' + fmtMoney(totalCourseFee))) + '</small></h4>' +
        '<table class="mpr-fe"><thead><tr><th>Fee head</th><th>Due</th><th>Status</th><th>Amount</th></tr></thead><tbody>' + ledgerRows + '</tbody></table>' +
      '</div>' +
      '<div class="mpr-sec"><ol class="mpr-terms">' +
        '<li>Fees once paid are not refundable or transferable.</li>' +
        '<li>Please keep this receipt safe. It is computer-generated and valid with the authorised signature.</li>' +
      '</ol></div>' +
      '<div class="mpr-sigs"><div>Student&#39;s signature</div><div>Authorised signatory</div></div>' +
      '<div class="mpr-ft"><span>' + esc(orgName) + ' &nbsp;|&nbsp; Generated on ' + esc(pDateStr) + '</span><span>Page 1 of 1</span></div>';
  }

  function safeImageToDataUrl(imgEl) {
    return new Promise(function(resolve){
      if (!imgEl || !imgEl.src) { resolve(null); return; }
      if (imgEl.src.indexOf('data:') === 0) { resolve(imgEl.src); return; }
      function convert() {
        try {
          if (!imgEl.naturalWidth) { resolve(null); return; }
          var c = document.createElement('canvas');
          c.width = imgEl.naturalWidth;
          c.height = imgEl.naturalHeight;
          c.getContext('2d').drawImage(imgEl, 0, 0);
          resolve(c.toDataURL('image/png'));
        } catch (_) {
          resolve(null);
        }
      }
      if (imgEl.complete) convert();
      else {
        imgEl.addEventListener('load', convert, { once: true });
        imgEl.addEventListener('error', function(){ resolve(null); }, { once: true });
      }
    });
  }

  async function resolveDataUrl(relPath, resolveMediaFn) {
    if (!relPath) return null;
    try {
      var src = typeof resolveMediaFn === 'function' ? await resolveMediaFn(relPath) : relPath;
      if (!src) return null;
      if (src.indexOf('data:') === 0) return src;
      var img = new Image();
      img.src = src;
      await new Promise(function(res){
        if (img.complete) res();
        else { img.onload = res; img.onerror = res; setTimeout(res, 1500); }
      });
      return await safeImageToDataUrl(img);
    } catch (_) {
      return null;
    }
  }

  async function buildYouthPdfDefinition(d, resolveMediaFn) {
    var imgs = await Promise.all([
      resolveDataUrl(d.orgLogoRel, resolveMediaFn),
      resolveDataUrl(d.photoRel, resolveMediaFn),
      resolveDataUrl(d.signatureRel, resolveMediaFn)
    ]);
    var logoData = imgs[0], photoData = imgs[1], sigData = imgs[2];
    var content = [];

    var logoCell = logoData
      ? { image: logoData, width: 48, height: 48, alignment: 'center' }
      : { table: { widths: [48], body: [[{ text: 'UI', bold: true, fontSize: 18, color: WHITE, fillColor: NAVY, alignment: 'center', margin: [0, 12, 0, 12] }]] }, layout: 'noBorders' };

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
                { text: d.orgPhones + '   |   Email: ' + d.orgEmail + '\\n', color: MUTED },
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

    content.push({
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 2, lineColor: NAVY },
        { type: 'line', x1: 0, y1: 3, x2: 523, y2: 3, lineWidth: 0.8, lineColor: GOLD }
      ],
      margin: [0, 0, 0, 8]
    });

    content.push({ text: 'ADMISSION RECEIPT', bold: true, fontSize: 12, color: NAVY, alignment: 'center', letterSpacing: 2, margin: [0, 0, 0, 2] });
    content.push({
      text: [{ text: 'Receipt no: ' }, { text: d.receiptNo || '-', bold: true }, { text: '   |   Date: ' }, { text: d.receiptDate || '-', bold: true }],
      fontSize: 8, color: MUTED, alignment: 'center', margin: [0, 0, 0, 8]
    });

    var photoCell = photoData
      ? { rowSpan: 7, stack: [{ image: photoData, width: 72, height: 90, alignment: 'center' }], alignment: 'center', margin: [0, 2, 0, 2] }
      : { rowSpan: 7, table: { widths: [72], body: [[{ text: 'Photo', fontSize: 8, color: MUTED, alignment: 'center', margin: [0, 36, 0, 36] }]] }, layout: { hLineWidth: function(){return 0.5;}, vLineWidth: function(){return 0.5;}, hLineColor: function(){return LINE;}, vLineColor: function(){return LINE;} }, alignment: 'center', margin: [0, 2, 0, 2] };

    var sigCell = sigData
      ? { rowSpan: 3, stack: [{ image: sigData, width: 72, height: 24, alignment: 'center' }, { text: "Student's signature", fontSize: 6.5, color: MUTED, alignment: 'center', margin: [0, 1, 0, 0] }], alignment: 'center', margin: [0, 2, 0, 2] }
      : { rowSpan: 3, table: { widths: [72], body: [[{ stack: [{ text: 'Signature', fontSize: 7, color: MUTED, alignment: 'center', margin: [0, 6, 0, 0] }, { text: "Student's signature", fontSize: 6, color: MUTED, alignment: 'center', margin: [0, 2, 0, 4] }] }]] }, layout: { hLineWidth: function(){return 0.5;}, vLineWidth: function(){return 0.5;}, hLineColor: function(){return LINE;}, vLineColor: function(){return LINE;} }, alignment: 'center', margin: [0, 2, 0, 2] };

    function lbl(t) { return { text: t, fontSize: 7, bold: true, color: INK, fillColor: TINT, margin: [0, 1.2, 0, 1.2] }; }
    function val(t, b) { return { text: t || '-', fontSize: 7, bold: Boolean(b), color: INK, margin: [0, 1.2, 0, 1.2] }; }
    function spanRow(title, text, b) { return [lbl(title), { text: text || '-', colSpan: 2, fontSize: 7, bold: Boolean(b), color: INK, margin: [0, 1.2, 0, 1.2] }, {}]; }

    var detailsBody = [
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
      spanRow('Student ID', d.studentId, true),
      spanRow('Admission date', d.admissionDate, true),
      spanRow('Course', d.courseFullName, true),
      spanRow('Course code', d.courseCode, false),
      spanRow('Duration', d.duration, false),
      spanRow('Batch', d.batchName, true),
      spanRow('Session', d.sessionName, true),
      spanRow('Session begins', d.sessionBegins, false),
      spanRow('Session ends', d.sessionEnds, false),
      spanRow('Branch', d.branchName, true),
      spanRow('Branch address', d.branchAddress, false)
    ];

    content.push({
      table: { widths: [95, 332, 80], body: detailsBody },
      layout: {
        hLineWidth: function(){ return 0.5; }, vLineWidth: function(){ return 0.5; },
        hLineColor: function(){ return LINE; }, vLineColor: function(){ return LINE; },
        paddingLeft: function(){ return 4; }, paddingRight: function(){ return 4; },
        paddingTop: function(){ return 1.5; }, paddingBottom: function(){ return 1.5; }
      },
      margin: [0, 0, 0, 10]
    });

    content.push({ columns: [{ text: 'Course syllabus', bold: true, fontSize: 9.5, color: NAVY }, { text: d.courseCode + ' - ' + d.duration, fontSize: 7.5, color: MUTED, alignment: 'right' }], margin: [0, 2, 0, 2] });
    content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1.5, lineColor: NAVY }], margin: [0, 0, 0, 6] });

    var mods = d.modules || [];
    var half = Math.ceil(mods.length / 2);
    var modRows = [];
    for (var i = 0; i < Math.max(half, mods.length - half); i++) {
      var lText = mods[i] || '';
      var rText = mods[i + half] || '';
      modRows.push([
        { text: lText ? ((i + 1) + '. ') : '', bold: true, fontSize: 7, color: GOLD },
        { text: lText, fontSize: 7, color: INK },
        { text: rText ? ((i + 1 + half) + '. ') : '', bold: true, fontSize: 7, color: GOLD },
        { text: rText, fontSize: 7, color: INK }
      ]);
    }
    if (modRows.length) {
      content.push({
        table: { widths: [14, 235, 14, 235], body: modRows },
        layout: { hLineWidth: function(){ return 0.4; }, vLineWidth: function(){ return 0; }, hLineColor: function(){ return LINE; }, paddingTop: function(){ return 2.5; }, paddingBottom: function(){ return 2.5; } },
        margin: [0, 0, 0, 10]
      });
    }
    content.push({ columns: [{ text: d.orgName + '   |   Generated on ' + d.generatedDate, fontSize: 7, color: MUTED }, { text: 'Page 1 of 2', fontSize: 7, color: MUTED, alignment: 'right' }], margin: [0, 6, 0, 0] });

    // Page 2
    content.push({
      pageBreak: 'before',
      columns: [
        { width: 36, stack: [logoData ? { image: logoData, width: 30, height: 30 } : { table: { widths: [30], body: [[{ text: 'UI', bold: true, fontSize: 11, color: WHITE, fillColor: NAVY, alignment: 'center', margin: [0, 6, 0, 6] }]] }, layout: 'noBorders' }] },
        { width: '*', stack: [{ text: d.orgName, bold: true, fontSize: 11, color: NAVY }, { text: d.branchName, fontSize: 7.5, color: MUTED }], margin: [4, 2, 0, 0] },
        { width: 200, stack: [
          { text: [{ text: 'Receipt no: ' }, { text: d.receiptNo, bold: true, color: INK }], fontSize: 7.5, color: MUTED, alignment: 'right' },
          { text: [{ text: 'Student: ' }, { text: d.studentName, bold: true, color: INK }, { text: '   |   ID: ' }, { text: d.studentId, bold: true, color: INK }], fontSize: 7.5, color: MUTED, alignment: 'right' }
        ] }
      ],
      margin: [0, 0, 0, 4]
    });
    content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1.5, lineColor: NAVY }, { type: 'line', x1: 0, y1: 2, x2: 523, y2: 2, lineWidth: 0.8, lineColor: GOLD }], margin: [0, 0, 0, 8] });
    content.push({ text: 'Fee structure', bold: true, fontSize: 9.5, color: NAVY, margin: [0, 0, 0, 4] });

    var feeRows = [[{ text: 'Fee head', bold: true, fontSize: 7.5, color: INK, fillColor: TINT }, { text: 'Due', bold: true, fontSize: 7.5, color: INK, fillColor: TINT }, { text: 'Amount', bold: true, fontSize: 7.5, color: INK, alignment: 'right', fillColor: TINT }]];
    (d.feeStructureRows || []).forEach(function(r){
      feeRows.push([{ text: r.head, fontSize: 7, color: INK }, { text: r.due, fontSize: 7, color: INK }, { text: fmtRs(r.amount), fontSize: 7, color: INK, alignment: 'right' }]);
    });
    feeRows.push([{ text: 'Total course fee', colSpan: 2, bold: true, fontSize: 7.5, color: INK, fillColor: TINT }, {}, { text: fmtRs(d.totalCourseFee != null ? d.totalCourseFee : d.feeTotal), bold: true, fontSize: 7.5, color: INK, alignment: 'right', fillColor: TINT }]);
    content.push({
      table: { widths: ['*', 120, 100], body: feeRows },
      layout: {
        hLineWidth: function(i, n){ return (i===0||i===1||i===n.table.body.length-1||i===n.table.body.length) ? 1 : 0.4; },
        vLineWidth: function(){ return 0.4; },
        hLineColor: function(i, n){ return (i===1||i===n.table.body.length-1) ? NAVY : LINE; },
        vLineColor: function(){ return LINE; },
        paddingTop: function(){ return 2; }, paddingBottom: function(){ return 2; }
      },
      margin: [0, 0, 0, 10]
    });

    content.push({ columns: [{ text: 'Payment received at admission', bold: true, fontSize: 9.5, color: NAVY }, { text: 'Date: ' + d.admissionDate, fontSize: 7.5, color: MUTED, alignment: 'right' }], margin: [0, 0, 0, 4] });
    var payRows = [[{ text: 'Description', bold: true, fontSize: 7.5, color: INK, fillColor: TINT }, { text: 'Status', bold: true, fontSize: 7.5, color: INK, fillColor: TINT }, { text: 'Amount', bold: true, fontSize: 7.5, color: INK, alignment: 'right', fillColor: TINT }]];
    (d.paymentReceivedRows || []).forEach(function(r){
      payRows.push([{ text: r.description, fontSize: 7, color: INK }, { text: r.status, fontSize: 7, bold: true, color: NAVY }, { text: fmtRs(r.amount), fontSize: 7, color: INK, alignment: 'right' }]);
    });
    content.push({
      table: { widths: ['*', 90, 100], body: payRows },
      layout: { hLineWidth: function(i, n){ return (i===0||i===1||i===n.table.body.length)?1:0.4; }, vLineWidth: function(){return 0.4;}, hLineColor: function(i){return i===1?NAVY:LINE;}, vLineColor: function(){return LINE;}, paddingTop: function(){return 2;}, paddingBottom: function(){return 2;} },
      margin: [0, 0, 0, 6]
    });

    content.push({
      table: {
        widths: ['50%', '50%'],
        body: [[
          { fillColor: TINT, stack: [{ text: 'TOTAL RECEIVED', fontSize: 6.5, bold: true, color: MUTED }, { text: fmtRs(d.receivedAmount), bold: true, fontSize: 10, color: INK, margin: [0,1,0,1] }, { text: '(' + d.amountInWords + ')', fontSize: 6.5, color: MUTED }], margin: [4,4,4,4] },
          { fillColor: NAVY, stack: [{ text: 'BALANCE DUE', fontSize: 6.5, bold: true, color: '#C5CBE1' }, { text: fmtRs(d.balanceDue), bold: true, fontSize: 10, color: WHITE, margin: [0,1,0,1] }, { text: '(' + d.balanceDueWords + ')', fontSize: 6.5, color: '#C5CBE1' }], margin: [4,4,4,4] }
        ]]
      },
      layout: { hLineWidth: function(){return 0.5;}, vLineWidth: function(){return 0.5;}, hLineColor: function(){return LINE;}, vLineColor: function(){return LINE;} },
      margin: [0, 0, 0, 6]
    });

    content.push({
      table: { widths: ['*'], body: [[{ fillColor: TINT, text: [{ text: 'Important - Examination fee: ', bold: true, color: INK }, { text: 'The examination fee is not included in the total course fee shown above. It will be charged as per the Government order in force at the time of the examination, and is payable in addition to the balance due.', color: INK }], fontSize: 6.8, lineHeight: 1.25, margin: [6,4,6,4] }]] },
      layout: { hLineWidth: function(){return 0.5;}, vLineWidth: function(i){return i===0?3:0.5;}, hLineColor: function(){return LINE;}, vLineColor: function(i){return i===0?NAVY:LINE;} },
      margin: [0, 0, 0, 10]
    });

    content.push({ text: 'Terms & conditions', bold: true, fontSize: 9.5, color: NAVY, margin: [0, 0, 0, 3] });
    var terms = [
      'Prerequisite: no prior qualification or computer knowledge is required for this course.',
      'Examination: the examination will be held as per notice after completion of the course.',
      'Certification: the certificate is issued only on passing the examination.',
      'Fees once paid are not refundable or transferable.',
      'Instalments must be paid on or before the due date. A late fine of Rs. 1 per day will be charged after the due date.',
      'The examination fee, as notified, must be paid before the student can appear for the examination.',
      'Keep this receipt safe. It is required for all future payments and certificate collection. Please remember your Student ID (' + d.studentId + '), as it is needed to pay your instalments in our system.',
      'This is a computer-generated receipt and is valid with the authorised signature.'
    ];
    content.push({ ol: terms.map(function(t){ return { text: t, fontSize: 6.8, color: '#2B2850', lineHeight: 1.2, margin: [0, 0.5, 0, 0.5] }; }), margin: [0, 0, 0, 20] });

    content.push({
      columns: [
        { width: 180, stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 170, y2: 0, lineWidth: 0.8, lineColor: INK }] }, { text: "Student's signature", fontSize: 7.5, color: MUTED, alignment: 'center', margin: [0, 3, 0, 0] }] },
        { width: '*', text: '' },
        { width: 180, stack: [{ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 170, y2: 0, lineWidth: 0.8, lineColor: INK }] }, { text: 'Authorised signatory', fontSize: 7.5, color: MUTED, alignment: 'center', margin: [0, 3, 0, 0] }] }
      ],
      margin: [0, 10, 0, 8]
    });
    content.push({ text: 'Thank you for choosing Unique Infotech. We wish you success in your course.', fontSize: 7, color: MUTED, alignment: 'center', margin: [0, 0, 0, 8] });
    content.push({ columns: [{ text: d.orgName + '   |   Generated on ' + d.generatedDate, fontSize: 7, color: MUTED }, { text: 'Page 2 of 2', fontSize: 7, color: MUTED, alignment: 'right' }], margin: [0, 2, 0, 0] });

    return { pageSize: 'A4', pageOrientation: 'portrait', pageMargins: [36, 24, 36, 24], content: content, defaultStyle: { fontSize: 8, color: INK } };
  }

  async function downloadAdmissionReceiptPdf(student, data, resolveMediaFn) {
    if (!window.pdfMake || !window.pdfMake.createPdf) {
      throw new Error('pdfMake offline library is unavailable.');
    }
    var model = buildAdmissionReceiptModel(student, data);
    var docDef = await buildYouthPdfDefinition(model, resolveMediaFn);
    var rNo = String(model.receiptNo || 'Receipt').replace(/[^a-zA-Z0-9_-]/g, '_');
    var sNm = String(model.studentName || 'Student').replace(/[^a-zA-Z0-9_-]/g, '_');
    var fname = 'Receipt_' + rNo + '_' + sNm + '.pdf';
    return new Promise(function(resolve){
      window.pdfMake.createPdf(docDef).download(fname, resolve);
    });
  }

  async function downloadPaymentReceiptPdf(sheetEl, entry, student) {
    if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('Offline PDF libraries are unavailable.');
    }
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    var imgs = Array.prototype.slice.call(sheetEl.querySelectorAll('img'));
    await Promise.all(imgs.map(function(img){
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(function(res){
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 2000);
      });
    }));

    // Check safely if any image came from raw file:// that Chromium canvas treats as tainted
    var taintedPaths = [];
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (!im.naturalWidth) continue;
      if (im.src.indexOf('file:') === 0) {
        try {
          var tc = document.createElement('canvas'); tc.width = 2; tc.height = 2;
          tc.getContext('2d').drawImage(im, 0, 0);
          tc.toDataURL('image/png');
        } catch (_) {
          taintedPaths.push(im.getAttribute('data-arc-src') || im.alt || 'img');
        }
      }
    }

    var canvas = await window.html2canvas(sheetEl, {
      scale: 3,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      onclone: function(clonedDoc) {
        var p = clonedDoc.getElementById('av-mpr-sheet');
        if (p) {
          p.style.margin = '0';
          p.style.border = 'none';
          p.style.boxShadow = 'none';
          if (taintedPaths.length) {
            Array.prototype.slice.call(p.querySelectorAll('img')).forEach(function(ci){
              if (ci.src && ci.src.indexOf('file:') === 0) {
                var box = ci.parentElement;
                if (box) { box.classList.remove('img'); }
                ci.remove();
              }
            });
          }
        }
      }
    });

    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    var rClean = String(entry.receiptNo || entry.id || 'Receipt').replace(/[^a-zA-Z0-9_-]/g, '_');
    var sClean = String(student.studentId || student.id || 'Student').replace(/[^a-zA-Z0-9_-]/g, '_');
    pdf.save('Payment-Receipt-' + sClean + '-' + rClean + '.pdf');
    return { skippedTaintedImages: taintedPaths.length > 0 };
  }

  window.ArchiveReceipts = {
    buildAdmissionReceiptModel: buildAdmissionReceiptModel,
    buildAdmissionReceiptHtml: buildAdmissionReceiptHtml,
    buildPaymentReceiptHtml: buildPaymentReceiptHtml,
    downloadAdmissionReceiptPdf: downloadAdmissionReceiptPdf,
    downloadPaymentReceiptPdf: downloadPaymentReceiptPdf,
    inWords: inWords,
    fmtMoney: fmtMoney,
    fmtRs: fmtRs,
    fmtDate: fmtDatePad
  };
})();`;
