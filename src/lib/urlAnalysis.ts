// Real URL structural analysis + phishing-pattern detection, entirely
// client-side (native URL API + well-documented heuristics — no
// network request, no external reputation lookup here; the Domain &
// URL Scan tool elsewhere in this app does the real DNS/TLS/WHOIS/
// subdomain-enumeration work for a target you decide to investigate
// further).

export type UrlComponent = { label: string; value: string };

export type UrlFinding = {
  id: string;
  severity: "danger" | "warning" | "info" | "safe";
  title: string;
  summary: string;
  explanation: string;
  recommendation: string;
};

const URL_SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "rebrand.ly", "cutt.ly", "shorte.st", "tiny.cc", "rb.gy", "s.id", "v.gd",
]);

// TLDs seen disproportionately often in phishing/malware campaigns
// (frequently because they're unusually cheap or loosely moderated) —
// this is a real, commonly-cited pattern, not a guess, but plenty of
// legitimate sites use them too, so it's surfaced as informational.
const WATCH_TLDS = new Set(["zip", "mov", "top", "xyz", "gq", "tk", "ml", "cf", "ga", "country", "kim", "work", "click", "link", "download", "loan", "win"]);

export function analyzeUrl(raw: string): { components: UrlComponent[]; findings: UrlFinding[] } {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    return {
      components: [],
      findings: [{
        id: "unparseable",
        severity: "info",
        title: "Couldn't parse this as a URL",
        summary: "المُدخَل لا يبدو أنه رابط (URL) صالح.",
        explanation: "أي رابط سليم البنية يحتاج على الأقل إلى مضيف (host) — تحقق من وجود أخطاء إملائية أو أجزاء ناقصة.",
        recommendation: "أعد المحاولة برابط كامل، مثال: https://example.com/path",
      }],
    };
  }

  const findings: UrlFinding[] = [];
  const hostname = url.hostname.toLowerCase();

  const components: UrlComponent[] = [
    { label: "Protocol", value: url.protocol.replace(":", "") },
    { label: "Username:Password", value: url.username || url.password ? `${url.username}:${"*".repeat(url.password.length)}` : "(none)" },
    { label: "Host", value: hostname },
    { label: "Port", value: url.port || "(default)" },
    { label: "Path", value: url.pathname || "/" },
    { label: "Query parameters", value: url.search ? [...url.searchParams.keys()].join(", ") : "(none)" },
    { label: "Fragment", value: url.hash || "(none)" },
  ];

  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const ipv6 = hostname.startsWith("[") || /^[0-9a-f:]+$/i.test(hostname) && hostname.includes(":");
  if (ipv4 || ipv6) {
    findings.push({
      id: "ip-literal",
      severity: "danger",
      title: "Host is a raw IP address, not a domain name",
      summary: `الرابط يشير مباشرة إلى ${hostname} بدلاً من اسم نطاق مسمّى.`,
      explanation: "المواقع الشرعية تستخدم في الغالب اسم نطاق (domain name). ظهور عنوان IP خام داخل رابط هو نمط كلاسيكي في التصيّد (phishing) ونشر البرمجيات الخبيثة — لأنه يتجاوز خطوة تسجيل النطاق بالكامل، ولا يمكن حجبه بسهولة عبر قوائم الحظر المبنية على أسماء النطاقات.",
      recommendation: "تعامل معه بحذر شديد، خصوصاً إذا وصل ضمن رسالة/بريد غير مطلوب. مرّره عبر أداة IP / ASN Analyzer لمعرفة ما هو مستضاف فعلياً على هذا العنوان قبل اتخاذ أي إجراء آخر.",
    });
  }

  if (url.username || raw.includes("@") && !raw.trim().startsWith("mailto:")) {
    findings.push({
      id: "at-symbol",
      severity: "danger",
      title: "Contains an @ symbol before the real host",
      summary: `كل ما قبل رمز @ هو معلومات مصادقة يتجاهلها المتصفح — الوجهة الحقيقية هي "${hostname}".`,
      explanation: "الروابط تدعم بشكل اختياري مقطع \"username:password@\" قبل المضيف. المهاجمون يستغلون هذا بوضع نطاق موثوق الشكل قبل رمز @ (مثال: https://paypal.com@evil-site.example/) بحيث يرى القارئ السريع \"paypal.com\" بينما المتصفح فعلياً يذهب إلى evil-site.example.",
      recommendation: "حدّد دائماً المضيف الحقيقي — وهو الجزء الذي يأتي مباشرة بعد آخر رمز @ وقبل أول / أو :. هذا هو الموضع الفعلي الذي يقود إليه الرابط.",
    });
  }

  if (hostname.includes("xn--")) {
    findings.push({
      id: "punycode",
      severity: "warning",
      title: "Internationalized domain name (punycode)",
      summary: `"${hostname}" هي الصيغة المشفّرة بترميز ASCII (بونيكود) لنطاق يحتوي على أحرف غير لاتينية.`,
      explanation: "بونيكود يتيح للنطاقات استخدام أبجديات غير لاتينية، لكنه يُستغل أيضاً في هجمات homograph — أي تسجيل نطاق بأحرف تبدو مطابقة بصرياً لنطاق لاتيني موثوق (مثال: حرف \"а\" السيريلي بدلاً من الحرف اللاتيني \"a\") لانتحال شكله بصرياً.",
      recommendation: "فُك الترميز وقارن بصرياً مع النطاق المتوقّع. معظم المتصفحات تُظهر الصيغة اليونيكود المفكوكة في شريط العنوان — تحقق منها حرفاً بحرف بعناية.",
    });
  }

  const labels = hostname.replace(/^\[|\]$/g, "").split(".");
  const subdomainCount = Math.max(0, labels.length - 2);
  if (subdomainCount >= 4 && !ipv4 && !ipv6) {
    findings.push({
      id: "many-subdomains",
      severity: "warning",
      title: `Unusually many subdomain labels (${subdomainCount})`,
      summary: `المضيف: ${hostname}`,
      explanation: "سلسلة طويلة من النطاقات الفرعية (subdomains) تُستخدم أحياناً لدفن النطاق الأساسي المشبوه في عمق النص، على أمل أن تلتقط نظرة سريعة فقط الأجزاء الموحية بالثقة في البداية (مثال: \"secure-login.paypal.com.verify-account.example.net\" — النطاق الحقيقي هنا هو example.net، وليس paypal.com).",
      recommendation: "حدّد النطاق الفعلي القابل للتسجيل (غالباً آخر مقطعين) — هذا هو المالك الحقيقي، وليس ما يظهر أولاً.",
    });
  }

  if (URL_SHORTENERS.has(hostname)) {
    findings.push({
      id: "shortener",
      severity: "info",
      title: "This is a known URL-shortening service",
      summary: `${hostname} يخفي الوجهة الحقيقية إلى أن يتم تتبع الرابط فعلياً.`,
      explanation: "خدمات اختصار الروابط مفيدة بشكل شرعي، لكنها أيضاً مُستغلة بكثرة لإخفاء وجهة خبيثة خلف نطاق مختصر موثوق الشكل — الهدف الحقيقي لا يظهر إلا بعد حدوث إعادة التوجيه.",
      recommendation: "استخدم خدمة \"unshorten\" لمعاينة الرابط، أو تحقق من وجهة إعادة التوجيه قبل الضغط عليه، خصوصاً إذا وصل من مصدر غير موثوق.",
    });
  }

  const tld = labels[labels.length - 1];
  if (WATCH_TLDS.has(tld) && !ipv4 && !ipv6) {
    findings.push({
      id: "watch-tld",
      severity: "info",
      title: `".${tld}" is a TLD seen disproportionately often in abuse campaigns`,
      summary: `النطاق العلوي (TLD): ‎.${tld}`,
      explanation: "هذا نمط إحصائي وليس قاعدة ثابتة — الكثير من المواقع الشرعية تستخدم هذه النطاقات العلوية أيضاً (بعضها، مثل ‎.zip و‎.mov، هي أيضاً امتدادات ملفات حقيقية، وهو ما يُستغل بحد ذاته لجعل الرابط يبدو وكأنه اسم ملف). يستحق نظرة إضافية، وليس علامة خطر تلقائية.",
      recommendation: "قيّمه إلى جانب النتائج الأخرى هنا وتفاصيل تسجيل/استضافة النطاق الفعلية (أداة Domain & URL Scan).",
    });
  }

  const hyphenCount = (hostname.match(/-/g) ?? []).length;
  if (hyphenCount >= 3) {
    findings.push({
      id: "many-hyphens",
      severity: "info",
      title: `Domain contains ${hyphenCount} hyphens`,
      summary: `المضيف: ${hostname}`,
      explanation: "النطاقات التي تنتحل شخصية علامة تجارية غالباً ما تربط عدة كلمات بشرطات (مثال: secure-login-paypal-verify.com) لأن اسم العلامة التجارية بحد ذاته يكون عادة مسجّلاً مسبقاً لصاحبه الحقيقي.",
      recommendation: "تحقق مما إذا كان هذا النطاق مملوكاً فعلياً لمن يدّعي تمثيله عبر أداة Domain & URL Scan / WHOIS.",
    });
  }

  if (url.protocol !== "https:") {
    findings.push({
      id: "no-https",
      severity: "info",
      title: "Not using HTTPS",
      summary: `البروتوكول: ${url.protocol.replace(":", "")}`,
      explanation: "حركة بيانات HTTP غير المشفّرة يمكن اعتراضها أو تعديلها أثناء النقل. معظم المواقع الحديثة الشرعية تستخدم HTTPS افتراضياً؛ غيابه ليس دليلاً على شيء خبيث بحد ذاته، لكنه يستحق الملاحظة، خصوصاً لصفحة تسجيل دخول أو دفع.",
      recommendation: "تجنّب إدخال بيانات اعتماد أو معلومات حساسة على صفحة لا تستخدم HTTPS.",
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "clean",
      severity: "safe",
      title: "No red flags found in the URL's structure",
      summary: "لم تُطابق أي من الفحوصات البنيوية هنا.",
      explanation: "هذا يفحص بنية الرابط فقط — لا يقول شيئاً عن المحتوى الفعلي المستضاف هناك، أو ما إذا كان النطاق حديث التسجيل، أو مدرجاً في أي قائمة حظر.",
      recommendation: "لتقييم مخاطر حقيقي، مرّر النطاق عبر أداة Domain & URL Scan (فحص DNS وTLS وWHOIS واستخراج النطاقات الفرعية عبر crt.sh) وأداة Typosquat Checker.",
    });
  }

  return { components, findings };
}
