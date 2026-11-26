// Classic-script receipt renderer for the offline archive viewer (zero ES modules, zero Firebase, file:// safe).
export const ARCHIVE_RECEIPTS_VIEWER_JS = `(function(){
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtRs(n) {
    var v = Number(n) || 0;
    var neg = v < 0;
    var parts = Math.abs(v).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
    return (neg ? '- Rs.\\u00A0' : 'Rs.\\u00A0') + parts.join('.');
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    var s = String(iso).slice(0, 10);
    var m = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
    if (!m) return s;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return m[3] + ' ' + (months[Number(m[2]) - 1] || m[2]) + ' ' + m[1];
  }

  function inWords(num) {
    var n = Math.floor(Number(num) || 0);
    if (n === 0) return 'Rupees Zero Only';
    var a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    var b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seven'.replace('Seven','Seventy'),'Eighty','Ninety'];
    function two(v){ if (v < 20) return a[v]; var t = b[Math.floor(v/10)], u = a[v%10]; return u ? t + ' ' + u : t; }
    function three(v){ var str = ''; if (v >= 100) { str += a[Math.floor(v/100)] + ' Hundred'; v %= 100; if (v) str += ' '; } if (v) str += two(v); return str; }
    var words = '', rem = n;
    if (rem >= 10000000) { words += two(Math.floor(rem/10000000)) + ' Crore '; rem %= 10000000; }
    if (rem >= 100000) { words += two(Math.floor(rem/100000)) + ' Lakh '; rem %= 100000; }
    if (rem >= 1000) { words += two(Math.floor(rem/1000)) + ' Thousand '; rem %= 1000; }
    if (rem > 0) words += three(rem);
    return 'Rupees ' + words.trim() + ' Only';
  }

  function maskAadhaar(raw) {
    if (!raw) return '-';
    var clean = String(raw).replace(/\\D/g, '');
    if (clean.length < 4) return '-';
    return 'XXXX XXXX ' + clean.slice(-4);
  }

  function joinPhones(val, fb) {
    if (Array.isArray(val) && val.length) return val.join(', ');
    if (typeof val === 'string' && val.trim()) return val.trim();
    return fb || '-';
  }

  function isInstPaid(item, payments, student) {
    var no = Number(item.no != null ? item.no : item.installmentNo);
    if (Array.isArray(student.paidInstallments) && student.paidInstallments.indexOf(no) >= 0) return true;
    for (var i = 0; i < payments.length; i++) {
      var p = payments[i];
      var t = String(p.type || '').toUpperCase();
      if ((t === 'IN' || t === 'INST') && Number(p.installmentNo) === no) return true;
    }
    return Boolean(item.paid);
  }

  function buildAdmissionReceiptHtml(student, data, imgTagFn) {
    var org = data.org || {};
    var ss = data.session || {};
    var branch = (data.branchesById && data.branchesById[student.branchId]) || {};
    var course = (data.coursesById && data.coursesById[student.courseId]) || {};
    var batch = (data.batchesById && data.batchesById[student.batchId]) || {};
    var stPayments = (data.paymentsByStudent && data.paymentsByStudent[student.id]) || [];

    var orgName = org.orgName || 'Unique Infotech';
    var isoLine = org.tagline || 'Regd. Under C.R. Act M.H.R.D, Govt. of India · ISO 9001:2015 Certified Institute';
    var branchName = student.branchName || branch.name || 'Training Centre';
    var branchCode = student.branchCode || branch.code || branch.branchCode || branch.shortCode || 'HO';
    var orgPhones = joinPhones(org.phones || org.phone, '9474063315');
    var branchPhones = joinPhones(branch.phone || branch.phones, orgPhones);
    var receiptNo = student.admissionReceiptNo || student.fullReceiptNo || student.receiptNo || '-';
    var receiptDate = fmtDate(student.admissionDate || student.createdDate || ss.startDate);
    var logoHtml = imgTagFn(data.orgLogoPath, orgName + ' logo', 'logo');

    var docsList = (data.docsByStudent && data.docsByStudent[student.id]) || [];
    var photoEntry = null, sigEntry = null;
    for (var i = 0; i < docsList.length; i++) {
      if (docsList[i].key === 'photo') photoEntry = docsList[i];
      if (docsList[i].key === 'signature') sigEntry = docsList[i];
    }
    var photoHtml = photoEntry && photoEntry.path ? imgTagFn(photoEntry.path, 'Student photo', 'photo') : '<div class="photo"><span>Photo</span></div>';
    var sigHtml = sigEntry && sigEntry.path ? imgTagFn(sigEntry.path, 'Student signature', 'sig') : '<div class="sig"><span style="color:var(--muted);font-size:11px">Signature</span></div>';

    var snap = student.feeSnapshot || {};
    var fees = course.fees || {};
    var admFee = Number(snap.admission != null ? snap.admission : (fees.admission != null ? fees.admission : 0));
    var instAmt = Number(snap.installment != null ? snap.installment : (fees.installment != null ? fees.installment : 0));
    var matFee = Number(snap.material != null ? snap.material : (fees.material != null ? fees.material : 0));
    var isFull = student.paymentPlan === 'full';
    var sched = Array.isArray(student.feeSchedule) && student.feeSchedule.length ? student.feeSchedule : (data.defaultSchedule || []);

    var feeRows = [];
    feeRows.push({ head: 'Admission fee', due: 'At admission', amount: admFee });
    for (var j = 0; j < sched.length; j++) {
      var sItem = sched[j];
      feeRows.push({ head: 'Instalment ' + (sItem.no || sItem.installmentNo || (j + 1)), due: fmtDate(sItem.due), amount: Number(sItem.amount != null ? sItem.amount : instAmt) });
    }
    if (matFee > 0) feeRows.push({ head: 'Study material', due: 'At admission', amount: matFee });

    var totalCourseFee = Number(student.feeTotal != null ? student.feeTotal : feeRows.reduce(function(a,b){ return a + Number(b.amount || 0); }, 0));

    var payRows = [];
    var receivedAtAdm = 0;
    for (var k = 0; k < stPayments.length; k++) {
      var p = stPayments[k];
      var t = String(p.type || '').toUpperCase();
      if (t === 'AD' || t === 'FULL' || t === 'MAT') {
        var amt = Number(p.amount || 0);
        receivedAtAdm += amt;
        payRows.push({ description: t === 'FULL' ? 'Course fee (Paid in full)' : (t === 'MAT' ? 'Study material' : 'Admission fee'), status: 'Paid', amount: amt });
      }
    }
    if (!payRows.length && receivedAtAdm === 0) {
      var estAdm = isFull ? Number(student.fullPaymentAmount || totalCourseFee) : (admFee + matFee);
      receivedAtAdm = estAdm;
      payRows.push({ description: isFull ? 'Course fee (Paid in full)' : 'Admission / Material fee', status: 'Paid', amount: estAdm });
    }
    var balanceDue = isFull ? 0 : Math.max(0, totalCourseFee - receivedAtAdm);
    var modules = Array.isArray(course.curriculum) && course.curriculum.length ? course.curriculum : ['Syllabus covered as per centre timetable'];
    var modsHtml = modules.map(function(m, idx){ return '<div><i>' + (idx + 1) + '</i>' + esc(m) + '</div>'; }).join('');
    var feeRowsHtml = feeRows.map(function(r){ return '<tr><td>' + esc(r.head) + '</td><td>' + esc(r.due) + '</td><td>' + fmtRs(r.amount) + '</td></tr>'; }).join('');
    var payRowsHtml = payRows.map(function(r){ return '<tr><td>' + esc(r.description) + '</td><td><span class="pill paid">' + esc(r.status) + '</span></td><td>' + fmtRs(r.amount) + '</td></tr>'; }).join('');

    var genDate = fmtDate((data.meta && data.meta.generatedAtISO) || '');
    var maskedAadhaar = student.aadhaarMasked || maskAadhaar(student.aadhaar);

    return '<div class="ar-page">' +
      '<div class="hd">' + logoHtml +
        '<div><h1>' + esc(orgName) + '</h1><div class="iso">' + esc(isoLine) + '</div><div class="br">' + esc(branchName) + '</div><div class="ct"><b>' + esc(orgName) + ':</b> ' + esc(orgPhones) + ' &nbsp;|&nbsp; <b>Email:</b> ' + esc(org.email || '-') + '<br><b>' + esc(branchCode) + ':</b> ' + esc(branchPhones) + '</div></div>' +
      '</div>' +
      '<div class="title">Admission Receipt</div>' +
      '<div class="rno">Receipt no: ' + esc(receiptNo) + ' &nbsp;|&nbsp; Date: ' + esc(receiptDate) + '</div>' +
      '<table class="d">' +
        '<tr><th>Student name</th><td>' + esc(student.name || '-') + '</td><td class="pc" rowspan="6">' + photoHtml + '</td></tr>' +
        '<tr><th>Guardian name</th><td>' + esc(student.guardianName || student.fatherName || '-') + '</td></tr>' +
        '<tr><th>Date of birth</th><td>' + esc(fmtDate(student.dob)) + '</td></tr>' +
        '<tr><th>Gender</th><td>' + esc(student.gender || '-') + '</td></tr>' +
        '<tr><th>Mobile number</th><td>' + esc(student.phone || '-') + '</td></tr>' +
        '<tr><th>Alt. mobile number</th><td>' + esc(student.altPhone || '-') + '</td></tr>' +
        '<tr><th>Email</th><td>' + esc(student.email || '-') + '</td><td class="pc" rowspan="4">' + sigHtml + '<div class="cap">Student\\x27s signature</div></td></tr>' +
        '<tr><th>Qualification</th><td>' + esc(student.qualification || '-') + '</td></tr>' +
        '<tr><th>Address</th><td>' + esc(student.address || '-') + '</td></tr>' +
        '<tr><th>Aadhaar No.</th><td>' + esc(maskedAadhaar) + '</td></tr>' +
        '<tr><th>Student ID</th><td colspan="2">' + esc(student.studentId || '-') + '</td></tr>' +
        '<tr><th>Admission date</th><td colspan="2">' + esc(receiptDate) + '</td></tr>' +
        '<tr><th>Course</th><td colspan="2">' + esc(student.courseName || course.name || '-') + ' (' + esc(student.courseCode || course.code || '-') + ')</td></tr>' +
        '<tr><th>Batch</th><td colspan="2">' + esc(student.batchName || batch.name || '-') + '</td></tr>' +
        '<tr><th>Session</th><td colspan="2">' + esc(student.sessionName || ss.name || '-') + ' (' + esc(fmtDate(ss.startDate)) + ' - ' + esc(fmtDate(ss.endDate)) + ')</td></tr>' +
        '<tr><th>Branch</th><td colspan="2">' + esc(branchName) + '</td></tr>' +
      '</table>' +
      '<div class="sec"><h4><span>Course syllabus</span><small>' + esc(student.courseCode || course.code || '') + '</small></h4><div class="mods">' + modsHtml + '</div></div>' +
      '<div class="ft"><span>' + esc(orgName) + ' &nbsp;|&nbsp; Archive generated on ' + esc(genDate) + '</span><span>Page 1 of 2</span></div>' +
    '</div>' +
    '<div class="ar-page">' +
      '<div class="mini"><div class="l">' + logoHtml + '<div><b>' + esc(orgName) + '</b><br><span style="font-size:11.5px;color:var(--muted)">' + esc(branchName) + '</span></div></div><div style="text-align:right;font-size:12px;">Receipt no: <b>' + esc(receiptNo) + '</b><br>Student ID: <b>' + esc(student.studentId || '-') + '</b></div></div>' +
      '<div class="sec"><h4><span>Fee structure</span></h4><table class="fe"><thead><tr><th>Fee head</th><th>Due</th><th>Amount</th></tr></thead><tbody>' + feeRowsHtml + '</tbody><tfoot><tr><td colspan="2">Total course fee</td><td>' + fmtRs(totalCourseFee) + '</td></tr></tfoot></table></div>' +
      '<div class="sec"><h4><span>Payment received at admission</span><small>Date: ' + esc(receiptDate) + '</small></h4><table class="fe"><thead><tr><th>Description</th><th>Status</th><th>Amount</th></tr></thead><tbody>' + payRowsHtml + '</tbody></table>' +
      '<div class="pbox"><div class="pcell"><em>Total received</em><b>' + fmtRs(receivedAtAdm) + '</b><span class="w">(' + esc(inWords(receivedAtAdm)) + ')</span></div><div class="pcell"><em>Balance due at admission</em><b>' + fmtRs(balanceDue) + '</b><span class="w">(' + esc(inWords(balanceDue)) + ')</span></div></div>' +
      '<div class="imp"><b>Important - Examination fee:</b> Examination fee is charged separately as per Government order at examination time.</div></div>' +
      '<div class="sigs"><div>Student\\x27s signature</div><div>Authorised signatory</div></div>' +
      '<div class="ft"><span>' + esc(orgName) + ' &nbsp;|&nbsp; Offline Archive Copy</span><span>Page 2 of 2</span></div>' +
    '</div>';
  }

  function buildPaymentReceiptHtml(paymentEntry, student, data, imgTagFn) {
    var org = data.org || {};
    var ss = data.session || {};
    var branch = (data.branchesById && data.branchesById[student.branchId]) || {};
    var stPayments = (data.paymentsByStudent && data.paymentsByStudent[student.id]) || [];

    var orgName = org.orgName || 'Unique Infotech';
    var orgSub = org.tagline || 'An ISO 9001:2015 Certified Institute';
    var branchName = paymentEntry.branchName || student.branchName || branch.name || 'Training Centre';
    var orgPhones = joinPhones(org.phones || org.phone, '9474063315');
    var branchPhones = joinPhones(branch.phone || branch.phones, orgPhones);
    var logoHtml = imgTagFn(data.orgLogoPath, orgName + ' logo', 'mpr-logo');

    var docsList = (data.docsByStudent && data.docsByStudent[student.id]) || [];
    var photoEntry = null;
    for (var i = 0; i < docsList.length; i++) {
      if (docsList[i].key === 'photo') photoEntry = docsList[i];
    }
    var photoHtml = photoEntry && photoEntry.path ? imgTagFn(photoEntry.path, 'Student photo', 'mpr-photo') : '<div class="mpr-photo"><span>Photo</span></div>';

    var payType = String(paymentEntry.type || 'IN').toUpperCase();
    var isExam = payType === 'EX';
    var instNo = Number(paymentEntry.installmentNo || 1);
    var sched = Array.isArray(student.feeSchedule) && student.feeSchedule.length ? student.feeSchedule : (data.defaultSchedule || []);
    var paidAmt = Number(paymentEntry.amount || 0);
    var latePaid = Number(paymentEntry.lateFeePaid || 0);
    var lateWaived = Number(paymentEntry.lateFeeWaived || 0);
    var totalRecv = Number(paymentEntry.totalReceived != null ? paymentEntry.totalReceived : (paidAmt + latePaid));
    var titleText = isExam ? 'Board Examination Fee Receipt' : 'Monthly Fee Payment Receipt';
    var dueStr = isExam ? 'At Exam Registration' : fmtDate((sched[instNo - 1] && sched[instNo - 1].due) || paymentEntry.dueDate);
    var paidDateStr = fmtDate(paymentEntry.date);

    var instPaidSum = stPayments.filter(function(p){ var t = String(p.type||'').toUpperCase(); return t==='IN'||t==='INST'; }).reduce(function(a,b){ return a + Number(b.amount || 0); }, 0);
    var instTotalFee = sched.reduce(function(a,b){ return a + Number(b.amount || 0); }, 0);
    var balDue = isExam ? 0 : Math.max(0, instTotalFee - instPaidSum);

    var ledgerRows = isExam
      ? '<tr class="cur"><td>Board Examination fee (this receipt)</td><td>Exam registration</td><td><span class="pill paid">Paid</span></td><td>' + fmtRs(paidAmt) + '</td></tr>'
      : sched.map(function(it){
          var n = Number(it.no != null ? it.no : it.installmentNo);
          var isCur = n === instNo;
          var paid = isInstPaid(it, stPayments, student);
          return '<tr class="' + (isCur ? 'cur' : '') + '"><td>Instalment ' + n + ' of ' + (sched.length || 4) + (isCur ? ' (this receipt)' : '') + '</td><td>' + fmtDate(it.due) + '</td><td><span class="pill ' + (paid ? 'paid' : 'due') + '">' + (paid ? 'Paid' : 'Due') + '</span></td><td>' + fmtRs(it.amount || 0) + '</td></tr>';
        }).join('');

    var fineCell = lateWaived > 0
      ? 'Waived (' + esc(paymentEntry.recordedByDesignation || 'Authorised Signatory') + ')'
      : (latePaid > 0 ? fmtRs(latePaid) : 'Rs. 0.00');

    return '<div class="mpr-page">' +
      '<div class="mpr-hd">' + logoHtml + '<div><h1>' + esc(orgName) + '</h1><div class="mpr-iso">' + esc(orgSub) + '</div><div class="mpr-br">' + esc(branchName) + '</div><div class="mpr-ct"><b>' + esc(orgName) + ':</b> ' + esc(orgPhones) + ' &nbsp;|&nbsp; <b>Email:</b> ' + esc(org.email || '-') + '<br><b>Branch Contact:</b> ' + esc(branchPhones) + '</div></div></div>' +
      '<div class="mpr-title">' + titleText + '</div>' +
      '<div class="mpr-rno">Receipt no: <strong>' + esc(paymentEntry.receiptNo || '-') + '</strong> &nbsp;|&nbsp; Date: <strong>' + esc(paidDateStr) + '</strong></div>' +
      '<table class="mpr-d">' +
        '<tr><th>Student name</th><td><strong>' + esc(student.name || '-') + '</strong></td><td class="mpr-pc" rowspan="5">' + photoHtml + '</td></tr>' +
        '<tr><th>Guardian name</th><td>' + esc(student.guardianName || student.fatherName || '-') + '</td></tr>' +
        '<tr><th>Student ID</th><td><strong>' + esc(student.studentId || '-') + '</strong></td></tr>' +
        '<tr><th>Course</th><td>' + esc(student.courseName || student.courseCode || '-') + '</td></tr>' +
        '<tr><th>Batch / Session</th><td>' + esc(student.batchName || '-') + ' &nbsp;|&nbsp; ' + esc(student.sessionName || ss.name || '-') + '</td></tr>' +
      '</table>' +
      '<div class="mpr-sec"><h4><span>Payment details</span></h4><div class="mpr-meta"><div><em>Paid for</em><b>' + esc(paymentEntry.typeLabel || (isExam ? 'Exam fee' : 'Instalment ' + instNo)) + '</b></div><div><em>Due date</em><b>' + esc(dueStr) + '</b></div><div><em>Date of payment</em><b>' + esc(paidDateStr) + '</b></div><div><em>Late fine</em><b>' + fineCell + '</b></div></div>' +
      '<div class="mpr-pbox"><div class="mpr-pcell"><em>Amount received</em><b>' + fmtRs(totalRecv) + '</b><span class="w">(' + esc(inWords(totalRecv)) + ')</span></div><div class="mpr-pcell"><em>Balance due</em><b>' + fmtRs(balDue) + '</b></div></div></div>' +
      '<div class="mpr-sec"><h4><span>Fee ledger</span><small>' + (isExam ? 'Examination fee ' + fmtRs(paidAmt) : 'Course instalments ' + fmtRs(instTotalFee)) + '</small></h4><table class="mpr-fe"><thead><tr><th>Fee head</th><th>Due</th><th>Status</th><th>Amount</th></tr></thead><tbody>' + ledgerRows + '</tbody></table></div>' +
      '<div class="mpr-sec"><ol class="mpr-terms"><li>Fees once paid are not refundable or transferable.</li><li>Offline Archive Receipt Copy generated from preserved session records.</li></ol></div>' +
      '<div class="mpr-sigs"><div>Student\\x27s signature</div><div>Authorised signatory</div></div>' +
      '<div class="mpr-ft"><span>' + esc(orgName) + ' &nbsp;|&nbsp; Paid on ' + esc(paidDateStr) + '</span><span>Page 1 of 1</span></div>' +
    '</div>';
  }

  window.ArchiveReceipts = {
    buildAdmissionReceiptHtml: buildAdmissionReceiptHtml,
    buildPaymentReceiptHtml: buildPaymentReceiptHtml
  };
})();`;
