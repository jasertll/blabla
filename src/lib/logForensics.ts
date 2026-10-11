// Educational content + a real, regex-based multi-format log analyzer.
// Everything here runs client-side on whatever the user pastes in — no
// log content is ever sent anywhere. Detection rules are deliberately
// explainable (each one maps to a concrete, named pattern) rather than a
// black-box score, matching the rest of the app's "show your work" style.

export type LogFormatGuide = {
  id: string;
  name: string;
  category: "Host" | "Network" | "Web" | "Windows" | "DNS" | "URL";
  description: string;
  example: string;
  fields: { field: string; meaning: string }[];
  redFlags: { pattern: string; why: string }[];
  tips: string[];
};

export const LOG_FORMAT_GUIDES: LogFormatGuide[] = [
  {
    id: "syslog",
    name: "Linux syslog / auth.log",
    category: "Host",
    description:
      "سجل المصادقة القياسي في لينكس (‎/var/log/auth.log على ديبيان/أوبونتو، ‎/var/log/secure على RHEL/CentOS). كل محاولة تسجيل دخول عبر SSH، وكل استدعاء لـ sudo، وكل حدث PAM يُسجَّل هنا بصيغة تشبه RFC 3164. هذا عادة أول شيء تسحبه عند الاشتباه باختراق مضيف لينكس.",
    example:
`Aug 15 03:14:21 web01 sshd[14213]: Failed password for invalid user admin from 203.0.113.9 port 51422 ssh2
Aug 15 03:14:23 web01 sshd[14213]: Failed password for invalid user admin from 203.0.113.9 port 51430 ssh2
Aug 15 03:14:25 web01 sshd[14213]: Failed password for invalid user admin from 203.0.113.9 port 51438 ssh2
Aug 15 03:14:41 web01 sshd[14219]: Accepted password for root from 203.0.113.9 port 51502 ssh2
Aug 15 03:15:02 web01 sudo:    root : TTY=pts/0 ; PWD=/root ; USER=root ; COMMAND=/bin/chmod +s /bin/bash`,
    fields: [
      { field: "Timestamp", meaning: "الشهر/اليوم/الوقت — بدون سنة وبدون منطقة زمنية افتراضياً، وهذه ثغرة جنائية حقيقية؛ قارنها مع المنطقة الزمنية المحلية المعروفة للمضيف." },
      { field: "Hostname", meaning: "اسم الجهاز الذي أنتج السطر — مفيد عندما تُجمَّع السجلات من أجهزة متعددة مركزياً." },
      { field: "Process[PID]", meaning: "الخدمة (daemon) التي كتبت السطر، مثل sshd أو sudo أو su أو cron — ومعرّف العملية (PID) الخاص بها." },
      { field: "Message", meaning: "وصف الحدث بنص حر — وهنا تكمن الإشارة الفعلية (\"Failed password\"، \"Accepted publickey\"، \"session opened\")." },
    ],
    redFlags: [
      { pattern: "Repeated \"Failed password\" from the same source IP in a tight time window", why: "هجوم قوة غاشمة كلاسيكي (brute-force — MITRE ATT&CK T1110). ثلاث محاولات فأكثر خلال ثوانٍ يعني هجوماً مبرمجاً وليس خطأً بشرياً." },
      { pattern: "\"Failed password for invalid user X\"", why: "عبارة \"invalid user\" تعني أن الحساب غير موجود أصلاً على الجهاز — أي أن المهاجم يخمّن أسماء المستخدمين وليس فقط كلمات المرور. قائمة شائعة: admin، root، test، ubuntu، oracle، postgres." },
      { pattern: "\"Accepted\" immediately following a burst of \"Failed\" from the same IP", why: "الهجوم نجح. تعامل مع الحساب على أنه مخترق وتحقق مما فعلته تلك الجلسة بعد ذلك (أسطر sudo، مفاتيح SSH جديدة في ~/.ssh/authorized_keys، مهام cron جديدة)." },
      { pattern: "sudo COMMAND containing chmod +s, /bin/bash, or a reverse-shell one-liner", why: "أمر chmod +s /bin/bash يضبط بت SUID على شل — وهذا باب خلفي لتصعيد الصلاحيات يتيح لأي مستخدم لاحقاً تشغيل شل بصلاحيات root دون الحاجة إلى sudo مجدداً." },
      { pattern: "Successful root login over SSH at all", why: "تسجيل الدخول المباشر كـ root عبر SSH يجب تعطيله عادة (PermitRootLogin no) — إذا رأيته ناجحاً، فهذه ثغرة تحصين إضافية فوق أي شيء آخر يحدث." },
    ],
    tips: [
      "ابحث عن \"Failed password\" باستخدام grep ثم مرّرها عبر awk لعدّ التكرارات لكل عنوان IP مصدر — سطر أوامر واحد يحوّل مئات الأسطر إلى قائمة فورية لأكثر المهاجمين نشاطاً.",
      "قارن عنوان IP المصدر مع أداة IP / ASN Analyzer في هذا التطبيق — محاولات تسجيل دخول SSH من عناوين مزوّدي استضافة أو Tor exit تُعد إشارة أقوى بكثير من عنوان سكني عادي.",
      "أمر journalctl -u ssh --since \"1 hour ago\" يعطيك نفس البيانات على توزيعات systemd دون الحاجة إلى ملف سجل على الإطلاق.",
    ],
  },
  {
    id: "windows-security",
    name: "Windows Security Event Log (key events)",
    category: "Windows",
    description:
      "صيغة EVTX الأصلية ثنائية وتحتاج إلى Event Viewer أو wevtutil أو نظام SIEM لقراءتها — لكن الحقول أدناه هي ما يُطبّعه كل مُصدِّر (Sysmon، Windows Event Forwarding، Splunk، Sentinel) إليه. معرفة معرّفات الأحداث الخمسة هذه تغطي معظم عمليات فرز حوادث ويندوز (IR triage).",
    example:
`EventID=4625, Account Name=Administrator, Logon Type=3, Source Network Address=203.0.113.9, Failure Reason=Unknown user name or bad password
EventID=4625, Account Name=Administrator, Logon Type=3, Source Network Address=203.0.113.9, Failure Reason=Unknown user name or bad password
EventID=4624, Account Name=Administrator, Logon Type=3, Source Network Address=203.0.113.9
EventID=4672, Account Name=Administrator, Privilege List=SeDebugPrivilege SeBackupPrivilege
EventID=4688, Account Name=Administrator, New Process Name=powershell.exe, CommandLine=powershell.exe -nop -w hidden -EncodedCommand JABzAD0A...`,
    fields: [
      { field: "EventID", meaning: "الحقل الأهم على الإطلاق — يحدد نوع الحدث. 4624=تسجيل دخول ناجح، 4625=تسجيل دخول فاشل، 4672=تعيين صلاحيات خاصة/إدارية، 4688=إنشاء عملية جديدة، 4720=إنشاء حساب مستخدم جديد، 4698=إنشاء مهمة مجدولة." },
      { field: "Logon Type", meaning: "3=شبكي (SMB/RPC — نموذجي في الحركة الجانبية lateral movement)، 10=RDP، 2=تفاعلي (طرفية محلية)، 5=خدمة. تسجيلات دخول إدارية من النوع 3 من IP خارجي إشارة قوية على حركة جانبية." },
      { field: "Source Network Address", meaning: "مصدر محاولة تسجيل الدخول — حركة جانبية داخلية مقابل هجوم خارجي." },
      { field: "CommandLine (4688)", meaning: "الأمر الفعلي الذي أُطلقت به عملية جديدة — هنا يظهر PowerShell المشفّر/المموَّه." },
    ],
    redFlags: [
      { pattern: "Many 4625 (failed logon) events for the same account in seconds", why: "هجوم قوة غاشمة / رش كلمات مرور (password spray) ضد حساب ويندوز، بنفس منطق SSH لكن على المنفذ 445/3389/5985." },
      { pattern: "4672 (special privileges assigned) right after an unexpected 4624", why: "الجلسة التي سجّلت الدخول حصلت على صلاحيات مكافئة لصلاحيات المدير — أمر متوقع للمدراء المعروفين، لكنه مريب لحساب خدمة أو حساب فشل عدة مرات قبل النجاح." },
      { pattern: "4688 CommandLine containing -EncodedCommand, -enc, -nop, -w hidden, or IEX(", why: "PowerShell المشفّر بـ Base64 والمُخفي النافذة هو أسلوب قياسي (T1059.001، T1027) لتشغيل كود خبيث مع تفادي التسجيل البسيط المبني على الكلمات المفتاحية — فُك ترميز Base64 (عادة UTF-16LE) لرؤية الحمولة الفعلية." },
      { pattern: "4720 (new account created) followed by 4672 (privileges assigned) for that same account", why: "مهاجم يُنشئ حساب باب خلفي للاستمرارية (persistence) ويرفعه فوراً لصلاحيات مدير — خطوة كلاسيكية بعد الاختراق." },
    ],
    tips: [
      "أمر wevtutil qe Security /q:\"*[System[(EventID=4625)]]\" /f:text يسحب فقط عمليات تسجيل الدخول الفاشلة من السجل الحي دون الحاجة إلى Event Viewer.",
      "Sysmon (أداة مجانية من Microsoft Sysinternals) يسجّل معرّف الحدث 1 (إنشاء عملية مع سطر الأوامر الكامل والعملية الأم) بموثوقية أعلى بكثير من تدقيق ويندوز الافتراضي — ثبّته قبل وقوع الحادثة، لا أثناءها.",
      "سطر أوامر مليء بترميز Base64 يكاد دائماً يُفكّ بسهولة عبر أمر PowerShell التالي: [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($s)) — لاحظ أنه UTF-16LE وليس UTF-8.",
    ],
  },
  {
    id: "web-access",
    name: "Web Server Access Log (Apache/Nginx Combined)",
    category: "Web",
    description:
      "صيغة 'Combined Log Format' المستخدمة افتراضياً في Apache وNginx. كل طلب HTTP إلى الخادم يُسجَّل بسطر واحد — وهنا تلتقط محاولات حقن SQL، وعبور المسارات (path traversal)، وماسحات الثغرات، وبوتات credential-stuffing.",
    example:
`203.0.113.9 - - [15/Aug/2026:03:14:21 +0000] "GET /login.php?id=1' UNION SELECT username,password FROM users-- HTTP/1.1" 200 4521 "-" "sqlmap/1.7.2#stable"
203.0.113.9 - - [15/Aug/2026:03:14:22 +0000] "GET /../../../../etc/passwd HTTP/1.1" 404 162 "-" "sqlmap/1.7.2#stable"
198.51.100.4 - - [15/Aug/2026:03:15:01 +0000] "GET /wp-admin/setup-config.php HTTP/1.1" 404 162 "-" "Mozilla/5.0 (Nikto)"
192.0.2.15 - alice [15/Aug/2026:03:16:44 +0000] "POST /account/update HTTP/1.1" 200 890 "https://example.com/account" "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"`,
    fields: [
      { field: "Client IP", meaning: "أول حقل — عنوان الطالب (أو عنوان موازن التحميل، إذا لم يُسجَّل X-Forwarded-For بشكل منفصل — تحقق من ذلك دائماً)." },
      { field: "[timestamp]", meaning: "وقت الطلب، عادة مع إزاحة المنطقة الزمنية مضمّنة، بخلاف syslog." },
      { field: "\"METHOD path HTTP/version\"", meaning: "الطلب الفعلي — هنا تظهر حمولات الحقن ومحاولات عبور المسارات بنص واضح." },
      { field: "Status code", meaning: "200/301 = نجح، 403 = محظور، 404 = غير موجود — موجة من 404 عبر مسارات مختلفة كثيرة من IP واحد هي بصمة تخمين مجلدات (directory brute-force)." },
      { field: "User-Agent", meaning: "هوية العميل المُعلَنة ذاتياً — ماسحات الأمان (sqlmap، nikto، nmap، gobuster، dirbuster) غالباً ما تُعرّف نفسها هنا، رغم أن المهاجم الحقيقي عادة ما يزوّر هذا الحقل." },
    ],
    redFlags: [
      { pattern: "UNION SELECT, OR 1=1, or SQL comment markers (-- / #) in a query string", why: "محاولة حقن SQL (T1190 — SQL injection). حتى المحاولة الفاشلة/التي أعادت 404 تؤكد أن المهاجم يتحسس بنشاط ذلك المُعامل (parameter)." },
      { pattern: "../ or %2e%2e%2f sequences in the request path", why: "عبور مسارات/مجلدات (path/directory traversal) — محاولة قراءة ملفات خارج جذر الويب، وكلاسيكياً ‎/etc/passwd أو web.config." },
      { pattern: "<script>, javascript:, or onerror= in a query string", why: "تحسس لثغرة XSS انعكاسية (reflected XSS)." },
      { pattern: "User-Agent naming sqlmap, nikto, nmap, gobuster, dirbuster, or masscan", why: "بصمات أدوات فحص آلية — تُستخدم أيضاً في اختبارات الاختراق الشرعية، لذا تأكد من أن هذا كان مُصرَّحاً به قبل التعامل معه كحادثة." },
      { pattern: "One IP generating a burst of 404s across many distinct paths in seconds", why: "تخمين مجلدات/ملفات (البحث عن لوحات إدارة، نسخ احتياطية، أو تعرّض ‎.git/‎.env) حتى بدون User-Agent يُظهر أداة فحص معروفة." },
    ],
    tips: [
      "إذا كان الخادم خلف بروكسي عكسي/CDN، فعنوان العميل الحقيقي غالباً يكون في ترويسة X-Forwarded-For أو X-Real-IP، وليس في حقل IP المتصل — تأكد أن هذا فعلاً يُسجَّل.",
      "أمر awk '{print $1}' access.log | sort | uniq -c | sort -rn | head يرتّب فوراً عناوين IP المصدر حسب حجم الطلبات.",
      "مرّر عناوين IP المشبوهة إلى أداة IP / ASN Analyzer وWHOIS/geolocation في هذا التطبيق لمعرفة ما إذا كانت بنية تحتية لمركز بيانات/VPN/Tor مقابل عنوان سكني.",
    ],
  },
  {
    id: "firewall",
    name: "Firewall / Netfilter Log (iptables-style)",
    category: "Network",
    description:
      "صيغة سجل الحزم على مستوى النواة المستخدمة في أهداف iptables/netfilter LOG (ومشابهة جداً على pfSense/OPNsense). كل سطر هو قرار خاص بحزمة واحدة — وهذا هو الحقيقة الأساسية لما عبَر فعلياً حدود الشبكة، بغض النظر عمّا اختار أي تطبيق تسجيله.",
    example:
`Aug 15 03:20:11 gw kernel: [UFW BLOCK] IN=eth0 OUT= SRC=198.51.100.7 DST=10.0.0.5 PROTO=TCP SPT=51022 DPT=22 SYN
Aug 15 03:20:11 gw kernel: [UFW BLOCK] IN=eth0 OUT= SRC=198.51.100.7 DST=10.0.0.5 PROTO=TCP SPT=51023 DPT=3389 SYN
Aug 15 03:20:12 gw kernel: [UFW BLOCK] IN=eth0 OUT= SRC=198.51.100.7 DST=10.0.0.5 PROTO=TCP SPT=51024 DPT=445 SYN
Aug 15 03:20:12 gw kernel: [UFW BLOCK] IN=eth0 OUT= SRC=198.51.100.7 DST=10.0.0.5 PROTO=TCP SPT=51025 DPT=8080 SYN
Aug 15 03:21:40 gw kernel: [UFW ALLOW] IN=eth0 OUT= SRC=192.0.2.20 DST=10.0.0.5 PROTO=TCP SPT=443 DPT=51900 ACK`,
    fields: [
      { field: "SRC / DST", meaning: "عنوان IP المصدر والوجهة للحزمة." },
      { field: "PROTO", meaning: "TCP أو UDP أو ICMP." },
      { field: "SPT / DPT", meaning: "منفذ المصدر / منفذ الوجهة — DPT يوضح الخدمة المستهدَفة (22=SSH، 3389=RDP، 445=SMB، 23=Telnet هي الكلاسيكيات التي تستحق تنبيهاً بحد ذاتها)." },
      { field: "SYN / ACK / flags", meaning: "أعلام TCP على الحزمة — SYN وحيد بدون ACK/استجابة مطابقة يعني محاولة اتصال وليس جلسة فعلية قائمة." },
    ],
    redFlags: [
      { pattern: "One SRC hitting many distinct DPT values against one DST in a short window", why: "فحص منافذ (port scanning — T1046) — استطلاع لرسم خريطة ما هو مُصغٍ (listening) قبل اختيار ثغرة استغلال." },
      { pattern: "Inbound connection attempts to DPT 445 (SMB), 3389 (RDP), or 23 (Telnet) from outside the network", why: "هذه الخدمات يجب أن لا تكون تقريباً مكشوفة على الإنترنت أبداً؛ ظهورها هنا إما فحص أو محاولة استغلال فعلية لخدمة معروفة بثغراتها (EternalBlue للمنفذ 445، هجوم قوة غاشمة/BlueKeep للمنفذ 3389)." },
      { pattern: "A sudden spike in ALLOWed outbound connections to an unfamiliar external IP on an unusual port", why: "قد يكون إشارة تخابر (C2 beaconing) من مضيف داخلي مخترق مسبقاً — الحركة الصادرة تستحق مراقبة بنفس أهمية الحركة الواردة." },
    ],
    tips: [
      "عدّ قيم DPT المختلفة لكل SRC خلال نافذة زمنية — هذا المقياس الوحيد هو أرخص وأكثر كاشف فحص منافذ موثوقية موجود.",
      "حزمة SYN محظورة بدون سطر ALLOW مطابق يعني أن الجدار الناري أدى وظيفته؛ الحالات المثيرة للاهتمام هي ما نجح في المرور.",
      "اقرن سجلات الجدار الناري مع سجل طبقة التطبيق (ويب/مصادقة) لنفس الطابع الزمني — الجدار الناري يخبرك أن اتصالاً حدث، وسجل التطبيق يخبرك بما فعله فعلياً بعد وصوله.",
    ],
  },
  {
    id: "dns",
    name: "DNS Query Log",
    category: "DNS",
    description:
      "يُسجَّل من قبل المحلِّلات المتكررة (recursive resolvers مثل BIND، Unbound، dnsmasq، أو وحدة DNS في جدار ناري). ولأن البرمجيات الخبيثة تحتاج تقريباً دائماً إلى تحليل نطاق C2 في مرحلة ما، فسجلات DNS من أعلى المصادر قيمة وأكثرها إغفالاً في أي تحقيق.",
    example:
`15-Aug-2026 03:30:11.221 client 10.0.0.5#53211: query: update.microsoft.com IN A +
15-Aug-2026 03:30:45.009 client 10.0.0.5#53212: query: k3jd9fs0a1z8x7q2plttunnelc2.evil-domain.net IN TXT +
15-Aug-2026 03:30:45.100 client 10.0.0.5#53213: query: k3jd9fs0a1z8x7q2plttunnelc2.evil-domain.net IN TXT +
15-Aug-2026 03:31:02.884 client 10.0.0.5#53214: query: xk92jz.evil-domain.net IN A +`,
    fields: [
      { field: "client IP#port", meaning: "الجهاز الداخلي الذي أرسل الاستعلام — هذا مؤشرك على مضيف مخترق، وليس خادم DNS نفسه." },
      { field: "query: <domain> IN <type>", meaning: "الاسم الكامل الجاري تحليله ونوع السجل المطلوب." },
      { field: "Record type", meaning: "A = بحث عنوان عادي. أنواع السجلات TXT وNULL غير معتادة في التصفح العادي وهي الأنواع الكلاسيكية لأنفاق DNS (DNS tunneling)، إذ تستطيع حمل حمولة نصية/ثنائية عشوائية." },
    ],
    redFlags: [
      { pattern: "Long, high-entropy-looking subdomain labels (random-looking strings before the domain)", why: "نفق DNS (T1071.004) أو خوارزمية توليد نطاقات (DGA) تستخدمها البرمجيات الخبيثة للوصول إلى بنية C2 مع تفادي قوائم الحظر الثابتة — كل مقطع غالباً يشفّر جزءاً من بيانات مسرّبة أو إشارة تخابر." },
      { pattern: "Repeated TXT or NULL record queries to the same unfamiliar domain", why: "سجلات TXT يمكنها حمل نص عشوائي، ما يجعلها قناة نفق DNS شائعة (تستخدمها أدوات مثل dnscat2 وiodine)." },
      { pattern: "A newly-registered or very obscure domain being queried by many internal hosts simultaneously", why: "قد يشير إلى أداة زرع (dropper) أو رابط تصيّد خبيث مشترك عبر عدة أجهزة مخترقة." },
      { pattern: "Regular, periodic queries to the same domain at a fixed interval (e.g. every 60 seconds)", why: "سلوك تخابر C2 كلاسيكي — برمجية خبيثة تتحقق دورياً وفق مؤقّت يبدو مختلفاً جداً عن تصفح بشري طبيعي." },
    ],
    tips: [
      "رتّب النطاقات المُستعلَمة حسب طول المقطع وإنتروبيا الأحرف — النطاقات الشرعية نادراً ما تحتوي على نطاقات فرعية عشوائية الشكل بطول 40+ حرفاً.",
      "قارن أي نطاق مشبوه بأداتَي Domain & URL Scan وTyposquat Checker في هذا التطبيق قبل افتراض أنه خبيث — الكثير من شبكات CDN الشرعية تستخدم أيضاً نطاقات فرعية طويلة مبنية على تجزئة (hash).",
      "إن استطعت، سجّل عنوان IP للجهاز المُستعلِم وليس الاستعلام فقط — هذا ما يقودك فعلياً إلى الجهاز المصاب.",
    ],
  },
  {
    id: "url-structure",
    name: "URL Anatomy & Phishing Red Flags",
    category: "URL",
    description:
      "كل رابط (URL) يصلك أثناء الفرز — في بريد إلكتروني، رسالة دردشة، أو سطر سجل — مبني من نفس الأجزاء القليلة (البروتوكول، بيانات اعتماد اختيارية، المضيف، المنفذ، المسار، سلسلة الاستعلام، الجزء المرجعي). المهاجمون يستغلون الفجوات بين كيفية تحليل المتصفحات لهذه الأجزاء وكيفية قراءة البشر لها، لذا معرفة البنية الحقيقية هي أسرع طريقة لاكتشاف رابط ليس كما يبدو.",
    example:
`https://accounts-secure-verify.paypal.com.login-confirm.xyz/signin?redirect=https://paypal.com
http://paypal.com@203.0.113.44:8080/wp-admin/setup-config.php
https://bit.ly/3xK9pLm
https://xn--pypal-4ve.com/login`,
    fields: [
      { field: "Protocol", meaning: "http:// مقابل https:// — https يعني أن طبقة النقل مشفّرة، وهذا لا يقول شيئاً عن مدى جدارة الوجهة نفسها بالثقة." },
      { field: "userinfo@", meaning: "مقطع اختياري \"username:password@\" يسبق المضيف الحقيقي، وهو لا يزال صيغة صالحة في كل متصفح — يُستغل بانتظام لإخفاء الوجهة الحقيقية خلف بادئة موحية بالثقة." },
      { field: "Host", meaning: "الخادم الفعلي الذي سيتصل به المتصفح. فقط آخر مقطعين قبل المسار (النطاق القابل للتسجيل) يعكسان الملكية الحقيقية — كل ما قبل ذلك مجرد نطاقات فرعية يتحكم بها مالك النطاق." },
      { field: "Port", meaning: "يكون افتراضياً 443 (https) / 80 (http) عند حذفه. منفذ صريح غير معتاد (8080، 4443) على رابط يدّعي أنه لخدمة معروفة يستحق نظرة ثانية." },
      { field: "Path / query / fragment", meaning: "كل ما بعد المضيف — هنا عادة تعيش سلاسل إعادة التوجيه التي يتحكم بها المهاجم، واستغلال open-redirect، وأهداف نماذج سرقة بيانات الاعتماد." },
    ],
    redFlags: [
      { pattern: "A trusted brand name appears BEFORE an @ symbol in the URL", why: "كل ما قبل آخر رمز @ هو معلومات مصادقة يتجاهلها المتصفح بصمت — المضيف الحقيقي هو ما يأتي بعده. https://paypal.com@evil.example/ يذهب فعلياً إلى evil.example، وليس PayPal." },
      { pattern: "A trusted brand name appears as a SUBDOMAIN of an unrelated domain", why: "paypal.com.login-confirm.xyz ملكٌ لـ login-confirm.xyz، وليس PayPal — \"paypal.com\" هنا مجرد تسمية اختارها المالك الحقيقي، وليست دليل هوية." },
      { pattern: "The host is a raw IP address instead of a domain name", why: "الخدمات الشرعية تستخدم تقريباً دائماً نطاقاً مسجَّلاً. عنوان IP خام يتجاوز هذه الخطوة بالكامل وهو شائع في عدّات التصيّد والبرمجيات الخبيثة." },
      { pattern: "Punycode (xn--) in the hostname", why: "يتيح هجمات homograph — نطاق مبني من أحرف يونيكود تبدو متطابقة (مثال: حرف \"а\" السيريلي بدل \"a\" اللاتيني) لا يمكن تمييزها بصرياً عن نطاق علامة تجارية حقيقية." },
      { pattern: "A URL shortener (bit.ly, tinyurl.com, etc.)", why: "يخفي الوجهة الحقيقية إلى أن يُتبَع الرابط فعلياً — مفيد بشكل شرعي، لكنه أيضاً طريقة قياسية لتهريب رابط خبيث متجاوزاً الفحص البصري السريع." },
    ],
    tips: [
      "لإيجاد النطاق الحقيقي القابل للتسجيل، اقرأ من نهاية اسم المضيف إلى بدايته: خذ آخر مقطع (TLD) زائد المقطع الذي قبله (مثال: \"example.net\" في \"a.b.c.example.net\") — كل ما على اليسار مجرد نطاقات فرعية.",
      "مرّر مؤشر الفأرة (دون الضغط) لمعاينة الهدف الحقيقي في معظم برامج البريد والمتصفحات قبل أن تقرر اتباع رابط ما.",
      "استخدم أداة URL Analyzer أدناه للفحوصات البنيوية، ثم أداة Domain & URL Scan للصورة الحقيقية لـ DNS/TLS/WHOIS/النطاقات الفرعية، وأداة Typosquat Checker لاختبار نطاق يُشتبه بانتحاله علامة تجارية مباشرة.",
    ],
  },
];

export type RecoveryGuide = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  tools: { name: string; note: string }[];
  tips: string[];
};

export const RECOVERY_GUIDES: RecoveryGuide[] = [
  {
    id: "file-carving",
    title: "File Carving — Recovering Files Without Filesystem Metadata",
    summary:
      "\"حذف\" ملف على FAT/NTFS/ext4 لا يمحو بياناته تقريباً أبداً — بل فقط يعلّم المساحة كفارغة ويزيل إدخال الدليل (directory entry). وإلى أن يُكتب شيء آخر فوق تلك القطاعات، تبقى البايتات الفعلية موجودة على القرص. استخراج الملفات (file carving) هو تقنية مسح قطاعات القرص الخام بحثاً عن توقيعات ملفات معروفة (تماماً كما تفعل أداة File / Malware Inspector في هذا التطبيق لملف واحد) وإعادة بناء الملفات دون أي بنية نظام ملفات ترشدك على الإطلاق.",
    steps: [
      "لا تكتب على وسيط المصدر مرة أخرى أبداً — كل عملية كتابة هي فرصة للكتابة فوق نفس القطاعات التي تحاول استعادتها. صوّر القرص أولاً (dd، FTK Imager، أو حاجب كتابة عتادي write-blocker) واعمل فقط من الصورة.",
      "امسح الصورة الخام بحثاً عن توقيعات ترويسة معروفة (مثل FF D8 FF لـ JPEG، 25 50 44 46 لـ PDF — نفس جدول البايتات السحرية الذي تستخدمه أداة File Inspector في هذا التطبيق).",
      "لكل تطابق، استخرج (carve) للأمام من الترويسة إلى أن يُعثر على علامة نهاية الصيغة الخاصة (علامة FF D9 الختامية لـ JPEG، أو chunk الـ IEND في PNG) أو يُبلَغ حد أقصى ثابت للحجم.",
      "تحقق من صحة كل ملف مُستخرَج مرشّح — يجب أن يستطيع فاكّ صور حقيقي فتحه؛ الاستخراجات الفاسدة (تطابقات ترويسة إيجابية كاذبة داخل بيانات غير ذات صلة) شائعة وتحتاج إلى تصفية.",
    ],
    tools: [
      { name: "PhotoRec", note: "أداة استخراج مجانية ومفتوحة المصدر مبنية على التوقيعات — الأداة القياسية الأولى لاستعادة الصور/الفيديوهات/المستندات المحذوفة، تعمل على أي نظام ملفات." },
      { name: "TestDisk", note: "الأداة الشقيقة لـ PhotoRec — تستعيد الأقسام (partitions) المفقودة وتصلح جداول الأقسام/قطاعات الإقلاع التالفة بدلاً من ملفات فردية." },
      { name: "Autopsy / The Sleuth Kit", note: "مجموعة تحقيق جنائي كاملة مع استعادة واعية ببنية نظام الملفات (تقرأ بنى FAT/NTFS/ext4 الفعلية، وليس مجرد استخراج خام) إضافة إلى تحليل الجدول الزمني وسير عمل قضية/أدلة سليم." },
      { name: "Scalpel / Foremost", note: "أدوات استخراج خفيفة عبر سطر الأوامر، جيدة لمهام الاستعادة المبرمجة/الآلية على لينكس." },
    ],
    tips: [
      "معدل نجاح الاستخراج ينخفض بسرعة كلما طال استمرار استخدام القرص بعد الحذف — صوّره في أقرب وقت ممكن.",
      "أقراص SSD تعقّد هذا كثيراً: خاصية TRIM تمحو فعلياً الكتل المُحرَّرة في الخلفية، لذا استعادة الملفات المحذوفة على SSD أقل موثوقية بكثير مقارنة بقرص دوّار (HDD).",
      "جدول البايتات السحرية في أداة File / Malware Inspector في هذا التطبيق هو نفس التقنية الأساسية لكن مصغّرة لملف واحد مُستعاد مسبقاً — مفيد لتأكيد نوع جزء مُستخرَج فعلياً.",
    ],
  },
  {
    id: "exif-recovery",
    title: "EXIF & Embedded Metadata — What a Photo Reveals About Itself",
    summary:
      "تقريباً كل صورة من هاتف أو كاميرا تحمل بيانات EXIF: إحداثيات GPS، طابع زمني دقيق للالتقاط، طراز/موديل الجهاز، وأحياناً حتى البرنامج المستخدم لتعديلها. هذا إما أفضل دليل لديك أو أكبر تسريب خصوصية، بحسب أي جانب من التحقيق أنت عليه.",
    steps: [
      "استخرج كتلة EXIF (أداتا File / Malware Inspector وImage Forensics المخصصة تحت Digital Forensics Toolkit في هذا التطبيق تفعلان ذلك من جهة العميل، داخل متصفحك).",
      "تحقق من وسوم GPSLatitude/GPSLongitude — عند وجودها، تحدد بدقة أين التُقطت الصورة، غالباً في حدود أمتار قليلة.",
      "قارن DateTimeOriginal مع الطوابع الزمنية لنظام الملفات الخاصة بالملف نفسه — أي تعارض يمكن أن يشير إلى أن الملف نُسخ/أُعيد حفظه لاحقاً، أو أن ساعة الكاميرا كانت خاطئة.",
      "لاحظ أن معظم منصات التواصل الاجتماعي (فيسبوك، تويتر/X، إنستغرام، واتساب) تحذف بيانات EXIF عند الرفع للخصوصية — إذا كانت EXIF موجودة، فالملف على الأرجح جاء من الجهاز الأصلي أو من مرفق بريد/رسائل لم تُحذف بياناته، وليس من تحميل عبر وسائل التواصل الاجتماعي.",
    ],
    tools: [
      { name: "exiftool", note: "الأداة الذهبية القياسية لبيانات EXIF/الوصفية عبر سطر الأوامر — تقرأ وتكتب تقريباً كل صيغة بيانات وصفية موجودة، أبعد بكثير من EXIF وحدها (IPTC، XMP، وسوم خاصة بالمصنّع)." },
      { name: "This app's Image Forensics tool", note: "استخراج EXIF من جهة العميل إضافة إلى تحليل مستوى الخطأ (ELA) للمساعدة في اكتشاف مناطق الصورة التي عُدِّلت/رُكِّبت بعد الالتقاط الأصلي." },
    ],
    tips: [
      "صورة تحمل وسوم GPS بدون DateTimeOriginal (أو العكس) لا تزال مفيدة — البيانات الوصفية الجزئية أمر طبيعي، لا تتجاهلها.",
      "أعد ترميز إحداثيات GPS جغرافياً (خط عرض/طول ← عنوان شارع) باستخدام أي خدمة خرائط بمجرد استخراجها — الأرقام الخام وحدها صعبة التصرف عليها بسرعة.",
      "صور HEIC من آيفون تخزّن EXIF بشكل مختلف عن JPEG — أداة تفهم فقط EXIF الخاص بـ JPEG الكلاسيكي قد تفوتها بصمت. استخراج EXIF في هذا التطبيق عُزِّز خصيصاً للتعامل مع HEIC.",
    ],
  },
  {
    id: "memory-forensics",
    title: "Memory (RAM) Forensics — The Most Volatile, Most Honest Evidence",
    summary:
      "التحقيق الجنائي في القرص يُريك ما حُفظ. التحقيق الجنائي في الذاكرة يُريك ما كان يعمل فعلياً — برمجيات خبيثة نشطة، بيانات اعتماد مفكوكة التشفير، اتصالات شبكية، وكود مُحقَن قد لا يلمس القرص أبداً (البرمجيات الخبيثة عديمة الملفات fileless malware). وهو أيضاً الأكثر هشاشة: يختفي بمجرد انقطاع الطاقة عن الجهاز.",
    steps: [
      "التقط الذاكرة أولاً، قبل أي شيء آخر يلمس الجهاز — صورة ذاكرة حية (باستخدام أداة مثل WinPmem أو Magnet RAM Capture أو LiME على لينكس) يجب أن تكون من أولى إجراءات المستجيب، وحتى قبل فصل كابل الشبكة في معظم خطط الاستجابة.",
      "لا تُطفئ أبداً جهازاً تشتبه باختراقه ببساطة إذا كان التقاط الذاكرة ممكناً — هذا يدمر فوراً أكثر الأدلة تطايراً.",
      "حلّل الصورة الملتقطة بحثاً عن العمليات الجارية، الاتصالات الشبكية، مكتبات DLL المحمَّلة، والكود المُحقَن باستخدام إطار عمل تحليل ذاكرة.",
      "قارن أي أسماء عمليات/بصمات (hashes) مشبوهة وُجدت في الذاكرة مع أداتَي File / Malware Inspector والتحقق من التجزئات المعروفة الجيدة عبر CIRCL في هذا التطبيق.",
    ],
    tools: [
      { name: "Volatility 3", note: "إطار العمل القياسي مفتوح المصدر للتحقيق الجنائي في الذاكرة — إضافات لقوائم العمليات، الاتصالات الشبكية، اكتشاف الكود المُحقَن، خلايا الريجستري المُستخرَجة من الذاكرة، وأكثر بكثير." },
      { name: "WinPmem / Magnet RAM Capture", note: "أدوات مجانية لالتقاط الذاكرة على أنظمة ويندوز الحية." },
      { name: "LiME (Linux Memory Extractor)", note: "وحدة نواة (kernel module) لالتقاط الذاكرة على أنظمة لينكس الحية." },
    ],
    tips: [
      "مبدأ ترتيب التطايرية (order of volatility) — من الأكثر تطايراً إلى الأقل: سجلات/ذاكرة تخزين مؤقت للمعالج ← RAM ← حالة الشبكة ← العمليات الجارية ← القرص ← النسخ الاحتياطية/الأرشيفات — يجب أن يوجّه ترتيب جمعك للأدلة أثناء أي استجابة لنظام حي.",
      "البرمجيات الخبيثة عديمة الملفات التي تعيش بالكامل في الذاكرة (شائعة مع الهجمات المبنية على PowerShell — راجع علامة الخطر الخاصة بـ 4688/EncodedCommand في دليل سجل أمان ويندوز) غير مرئية للتحقيق الجنائي المعتمد على القرص فقط؛ وهذا بالضبط سبب أهمية التقاط الذاكرة حتى عندما تبدو صورة القرص نظيفة.",
    ],
  },
  {
    id: "chain-of-custody",
    title: "Chain of Custody — Making Evidence Usable, Not Just Found",
    summary:
      "إيجاد الأثر الصحيح نصف المهمة فقط. إذا لم تستطع إثبات بالضبط من تعامل معه، ومتى، وأنه لم يُعدَّل في الطريق، فقد يكون عديم القيمة كدليل — سواء كان ذلك لقضية جنائية، أو مسألة موارد بشرية داخلية، أو مجرد إقناع فريقك بأن النتيجة حقيقية.",
    steps: [
      "وثّق كل شيء من لحظة لمسك للدليل: التاريخ/الوقت، من جمعه، من أين، وكيف.",
      "احسب تجزئة (hash) لكل قطعة دليل رقمي فور الحصول عليها (SHA-256 كحد أدنى) وسجّل تلك التجزئة — إنها إثباتك أن النسخة التي تحللها لاحقاً مطابقة بايت-ببايت لما جمعته أصلاً.",
      "اعمل من نسخ، وليس من الأصل أبداً — صوّر القرص مرة واحدة، تحقق من مطابقة تجزئة الصورة، ثم ضع الأصل جانباً دون لمسه.",
      "سجّل كل وصول لاحق: من فتح الدليل، متى، ولماذا — أي فجوة في هذا السجل هي بالضبط ما سيستهدفه محامي دفاع (أو طرف متشكك) لاحقاً.",
      "خزّن الأدلة بأمان مع وصول مقيَّد ومُسجَّل طوال المدة التي قد تحتاجها.",
    ],
    tools: [
      { name: "This app's File / Malware Inspector", note: "كل تجزئة تحسبها (SHA-256/SHA-1/SHA-512) يمكن أن تكون سجل تكامل وقت الحصول على الدليل — انسخها إلى ملاحظات قضيتك لحظة تحليلك للملف." },
    ],
    tips: [
      "\"إن لم يُكتب، فلم يحدث\" هو الافتراض العملي في أي عملية قد تُتحدى نتائجك فيها لاحقاً.",
      "هذا مهم حتى خارج الإجراءات القانونية الرسمية — تقارير الحوادث الداخلية أيضاً تُفحَص، وسلسلة موثّقة ومُتحقَّق من تجزئتها تجعل استنتاجاتك أصعب بكثير على النقض.",
    ],
  },
];

// ---------------- Interactive log analyzer ----------------

export type LogFinding = {
  id: string;
  severity: "danger" | "warning" | "info" | "safe";
  title: string;
  summary: string;
  explanation: string;
  recommendation: string;
  lines: number[];
};

export type ParsedLogLine = {
  lineNumber: number;
  raw: string;
  format: string;
  fields: Record<string, string>;
};

function tryParseLine(raw: string, lineNumber: number): ParsedLogLine {
  // Syslog RFC3164-ish: "Mon DD HH:MM:SS host process[pid]: message"
  let m = raw.match(/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([\w.\-\/]+)(?:\[(\d+)\])?:\s*(.*)$/);
  if (m) {
    return { lineNumber, raw, format: "syslog", fields: { timestamp: m[1], host: m[2], process: m[3], pid: m[4] ?? "", message: m[5] } };
  }

  // Apache/Nginx combined log
  m = raw.match(/^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+[^"]*"\s+(\d{3})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"/);
  if (m) {
    return {
      lineNumber, raw, format: "web-access",
      fields: { ip: m[1], user: m[2], timestamp: m[3], method: m[4], path: m[5], status: m[6], size: m[7], referer: m[8], userAgent: m[9] },
    };
  }

  // key=value style (Windows Security export, firewall/netfilter)
  if (/EventID=/.test(raw) || /\bSRC=\S+/.test(raw)) {
    const fields: Record<string, string> = {};
    const kvRe = /([A-Za-z ]+)=([^\s,]+(?:\s(?!\w+=)[^\s,]*)*)/g;
    let km: RegExpExecArray | null;
    while ((km = kvRe.exec(raw))) {
      fields[km[1].trim()] = km[2].trim();
    }
    const format = /EventID=/.test(raw) ? "windows-security" : "firewall";
    return { lineNumber, raw, format, fields };
  }

  // DNS query log: "date time client IP#port: query: domain IN TYPE"
  m = raw.match(/client\s+([\d.]+)#(\d+):\s+query:\s+(\S+)\s+IN\s+(\S+)/);
  if (m) {
    return { lineNumber, raw, format: "dns", fields: { clientIp: m[1], clientPort: m[2], domain: m[3], recordType: m[4] } };
  }

  return { lineNumber, raw, format: "unknown", fields: {} };
}

const SCANNER_UA = /sqlmap|nikto|nmap|gobuster|dirbuster|masscan|acunetix|nessus|whatweb/i;
const SQLI_PATTERN = /(\bunion\b.{0,20}\bselect\b)|(\bor\b\s+1\s*=\s*1)|(--\s*$)|(\bselect\b.{0,30}\bfrom\b)/i;
const XSS_PATTERN = /<script|javascript:|onerror\s*=|onload\s*=/i;
const TRAVERSAL_PATTERN = /\.\.\/|\.\.%2f|%2e%2e/i;
const ENCODED_PS_PATTERN = /-enc(odedcommand)?\b|iex\(|-nop\b|-w(indowstyle)?\s+hidden|downloadstring|frombase64string/i;
const SENSITIVE_DPT = new Set(["22", "23", "445", "3389", "135", "139", "5900"]);

export function analyzeLogText(text: string): { parsed: ParsedLogLine[]; findings: LogFinding[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 500);
  const parsed = lines.map((l, i) => tryParseLine(l, i + 1));
  const findings: LogFinding[] = [];

  // --- Brute force: repeated failed auth from the same source ---
  const failedByIp = new Map<string, number[]>();
  const acceptedByIp = new Map<string, number[]>();
  for (const p of parsed) {
    if (p.format === "syslog") {
      const ipMatch = p.fields.message?.match(/from\s+([\d.]+)/);
      const ip = ipMatch?.[1];
      if (ip && /Failed password/i.test(p.fields.message)) {
        failedByIp.set(ip, [...(failedByIp.get(ip) ?? []), p.lineNumber]);
      }
      if (ip && /Accepted (password|publickey)/i.test(p.fields.message)) {
        acceptedByIp.set(ip, [...(acceptedByIp.get(ip) ?? []), p.lineNumber]);
      }
      if (p.fields.process === "sudo" && /(chmod \+s|\/bin\/bash|\/bin\/sh|nc -e|reverse)/i.test(p.fields.message ?? "")) {
        findings.push({
          id: `sudo-susp-${p.lineNumber}`, severity: "danger",
          title: "Suspicious privileged command via sudo",
          summary: `السطر ${p.lineNumber} يشغّل عبر sudo أمراً يبدو وكأنه باب خلفي لتصعيد صلاحيات (شل SUID، شل عكسي، أو ما شابه).`,
          explanation: "ضبط بت SUID على شل، أو تشغيل شل عكسي، هما أسلوبان كلاسيكيان للاستمرارية/تصعيد الصلاحيات بعد الاختراق — وليسا نشاطاً إدارياً طبيعياً.",
          recommendation: "تعامل مع المضيف على أنه مخترق. راجع كل ما فعله ذلك الحساب قبل وبعد هذا الأمر، وأعد بناء الجهاز بدلاً من الوثوق به لاحقاً.",
          lines: [p.lineNumber],
        });
      }
    }
    if (p.format === "windows-security" && p.fields["EventID"] === "4625") {
      const ip = p.fields["Source Network Address"];
      if (ip) failedByIp.set(ip, [...(failedByIp.get(ip) ?? []), p.lineNumber]);
    }
    if (p.format === "windows-security" && p.fields["EventID"] === "4624") {
      const ip = p.fields["Source Network Address"];
      if (ip) acceptedByIp.set(ip, [...(acceptedByIp.get(ip) ?? []), p.lineNumber]);
    }
    if (p.format === "windows-security" && p.fields["EventID"] === "4688" && p.fields["CommandLine"] && ENCODED_PS_PATTERN.test(p.fields["CommandLine"])) {
      findings.push({
        id: `ps-encoded-${p.lineNumber}`, severity: "danger",
        title: "Obfuscated PowerShell execution",
        summary: `السطر ${p.lineNumber} يشغّل PowerShell بأعلام ترميز/إخفاء نافذة — نمط تشغيل خبيث قياسي.`,
        explanation: "أعلام -EncodedCommand و-nop و-w hidden وIEX( وسلاسل Invoke-WebRequest/DownloadString هي بالضبط كيف يُشغّل المهاجمون الحمولات مع تفادي التسجيل البسيط لسطر الأوامر والمراجعة العادية.",
        recommendation: "فُك ترميز الأمر (UTF-16LE) لرؤية الحمولة الفعلية، وتحقق من العملية التي أطلقت PowerShell — سكريبت إداري شرعي نادراً ما يحتاج نافذة مخفية.",
        lines: [p.lineNumber],
      });
    }
  }
  for (const [ip, ls] of failedByIp) {
    if (ls.length >= 3) {
      const alsoAccepted = acceptedByIp.get(ip);
      findings.push({
        id: `bruteforce-${ip}`,
        severity: alsoAccepted ? "danger" : "warning",
        title: alsoAccepted ? "Brute force followed by a successful login" : "Possible brute-force authentication attempts",
        summary: `${ip} أنتج ${ls.length} محاولة تسجيل دخول فاشلة${alsoAccepted ? `، ثم نجح في السطر ${alsoAccepted[0]}` : ""}.`,
        explanation: alsoAccepted
          ? "دفعة من الفشل تليها مباشرة عملية نجاح من نفس المصدر هي أوضح توقيع اختراق بقوة غاشمة موجود."
          : "تسجيلات دخول فاشلة متعددة وسريعة من مصدر واحد يتوافق مع هجوم تخمين كلمات مرور آلي (MITRE ATT&CK T1110)، حتى دون تأكيد نجاح بعد.",
        recommendation: alsoAccepted
          ? "تعامل مع الحساب على أنه مخترق الآن. أجبر إعادة تعيين كلمة المرور، راجع ما فعلته الجلسة، وتحقق من إدخالات authorized_keys جديدة أو استمرارية مجدولة."
          : "احظر أو قيّد معدل هذا المصدر، وتأكد أن كلمة مرور الحساب المستهدَف قوية / غير معروفة بأنها مسرّبة مسبقاً.",
        lines: ls,
      });
    }
  }

  // --- Web log findings ---
  for (const p of parsed) {
    if (p.format !== "web-access") continue;
    if (SQLI_PATTERN.test(p.fields.path)) {
      findings.push({
        id: `sqli-${p.lineNumber}`, severity: "danger",
        title: "SQL injection attempt",
        summary: `السطر ${p.lineNumber}: مسار الطلب يحتوي على صياغة حقن SQL.`,
        explanation: "UNION SELECT وOR 1=1 وعلامات تعليق SQL الختامية هي اللبنات القياسية لتحسس/استغلال حقن SQL.",
        recommendation: "تأكد أن نقطة النهاية تستخدم استعلامات معلمَنة (parameterized queries). تحقق من سجلات التطبيق/سجلات تدقيق قاعدة البيانات حول هذا الطابع الزمني بحثاً عن علامات أن الاستعلام نُفِّذ فعلياً.",
        lines: [p.lineNumber],
      });
    } else if (TRAVERSAL_PATTERN.test(p.fields.path)) {
      findings.push({
        id: `traversal-${p.lineNumber}`, severity: "danger",
        title: "Path traversal attempt",
        summary: `السطر ${p.lineNumber}: مسار الطلب يحاول الهروب من جذر الويب.`,
        explanation: "تسلسلات ../ (أو صيغتها المُرمَّزة عبر URL) تحاول قراءة ملفات خارج المجلد المقصود — غالباً تستهدف ‎/etc/passwd أو ملفات إعداد تحوي بيانات اعتماد.",
        recommendation: "تحقق من أن خادم الويب/التطبيق يُطبِّع المسارات ويقيّدها بشكل صحيح. تحقق من رمز الاستجابة — رمز 200 هنا يعني أن العبور ربما نجح.",
        lines: [p.lineNumber],
      });
    } else if (XSS_PATTERN.test(p.fields.path)) {
      findings.push({
        id: `xss-${p.lineNumber}`, severity: "warning",
        title: "Possible XSS probing",
        summary: `السطر ${p.lineNumber}: مسار الطلب يحتوي على صياغة سكريبت/معالج أحداث.`,
        explanation: "حمولات XSS الانعكاسية عادة تُرسَل تلقائياً على كل مُعامل من قبل الماسحات — تطابق واحد لا يؤكد وجود ثغرة، لكنه يستحق التحقق.",
        recommendation: "تأكد أن التطبيق يرمّز المخرجات. تحقق مما إذا كان هذا المُعامل تحديداً يُعاد عرضه دون ترميز في أي استجابة.",
        lines: [p.lineNumber],
      });
    }
    if (SCANNER_UA.test(p.fields.userAgent)) {
      findings.push({
        id: `scanner-ua-${p.lineNumber}`, severity: "info",
        title: "Known scanner/tool User-Agent",
        summary: `السطر ${p.lineNumber}: يعرّف User-Agent نفسه بأنه ${p.fields.userAgent.match(SCANNER_UA)?.[0]}.`,
        explanation: "أدوات الفحص الأمني غالباً تُعلن عن نفسها في User-Agent افتراضياً. المهاجم الحقيقي عادة يزوّر هذا، لكن اختبار اختراق مُصرَّح به وغير مُعلَن يظهر أيضاً بهذا الشكل.",
        recommendation: "تأكد مما إذا كان هذا فحصاً مُصرَّحاً به. إن لم يكن كذلك، تعامل مع كل طلب من هذا المصدر كاستطلاع عدائي.",
        lines: [p.lineNumber],
      });
    }
  }

  // --- Firewall: port scan detection ---
  const dptByIp = new Map<string, Set<string>>();
  const dptLinesByIp = new Map<string, number[]>();
  for (const p of parsed) {
    if (p.format !== "firewall") continue;
    const src = p.fields["SRC"];
    const dpt = p.fields["DPT"];
    if (!src || !dpt) continue;
    if (!dptByIp.has(src)) dptByIp.set(src, new Set());
    dptByIp.get(src)!.add(dpt);
    dptLinesByIp.set(src, [...(dptLinesByIp.get(src) ?? []), p.lineNumber]);
    if (SENSITIVE_DPT.has(dpt)) {
      findings.push({
        id: `sensitive-port-${p.lineNumber}`, severity: "warning",
        title: `Connection attempt to a sensitive port (${dpt})`,
        summary: `السطر ${p.lineNumber}: حاول ${src} الاتصال بالمنفذ ${dpt}.`,
        explanation: "منافذ مثل 22 (SSH)، و23 (Telnet)، و445 (SMB)، و3389 (RDP)، و5900 (VNC) هي أهداف شائعة للاستغلال/القوة الغاشمة ويجب نادراً ما تكون قابلة للوصول من خارج شبكة موثوقة.",
        recommendation: "تأكد أن هذا المنفذ ليس مقصوداً أن يكون مكشوفاً على الإنترنت؛ وإن كان كذلك، تأكد أنه مُحدَّث ومحمي بمصادقة قوية (ويُفضَّل خلف VPN أيضاً).",
        lines: [p.lineNumber],
      });
    }
  }
  for (const [ip, ports] of dptByIp) {
    if (ports.size >= 4) {
      findings.push({
        id: `portscan-${ip}`, severity: "warning",
        title: "Possible port scan",
        summary: `حاول ${ip} الاتصال بـ ${ports.size} منفذاً مختلفاً (${[...ports].slice(0, 8).join(", ")}${ports.size > 8 ? "…" : ""}).`,
        explanation: "مصدر واحد يلمس منافذ وجهة مختلفة كثيرة خلال فترة قصيرة هو البصمة الكلاسيكية لاستطلاع الشبكة/فحص المنافذ (MITRE ATT&CK T1046).",
        recommendation: "احظر المصدر إن كان خارجياً. إن كان داخلياً، حدّد الجهاز — فقد يكون هو نفسه مخترقاً ويقوم بفحص جانبي.",
        lines: dptLinesByIp.get(ip) ?? [],
      });
    }
  }

  // --- DNS: tunneling / DGA-looking queries ---
  const dnsByDomain = new Map<string, number[]>();
  for (const p of parsed) {
    if (p.format !== "dns") continue;
    const domain = p.fields.domain;
    const label = domain.split(".")[0];
    const highEntropyLabel = label.length >= 20 && /[0-9]/.test(label) && /[a-z]/i.test(label);
    if (highEntropyLabel || p.fields.recordType === "TXT" || p.fields.recordType === "NULL") {
      dnsByDomain.set(domain, [...(dnsByDomain.get(domain) ?? []), p.lineNumber]);
    }
  }
  for (const [domain, ls] of dnsByDomain) {
    findings.push({
      id: `dns-tunnel-${domain}`,
      severity: ls.length >= 2 ? "danger" : "warning",
      title: "Possible DNS tunneling / DGA domain",
      summary: `تم الاستعلام عن "${domain}" ${ls.length} مرة بمقطع طويل/عالي الإنتروبيا أو نوع سجل غير معتاد.`,
      explanation: "مقاطع نطاقات فرعية طويلة تبدو عشوائية واستعلامات سجلات TXT/NULL هي التوقيع القياسي لأدوات نفق DNS (dnscat2، iodine) أو برمجية خبيثة تستخدم خوارزمية توليد نطاقات للوصول إلى بنية C2.",
      recommendation: "تحقق من أي مضيف داخلي أصدر هذا الاستعلام وابحث فيه مباشرة — سجلات DNS تقودك إلى عنوان العميل، وهو دليلك الفعلي هنا.",
      lines: ls,
    });
  }

  if (findings.length === 0 && parsed.some((p) => p.format !== "unknown")) {
    findings.push({
      id: "clean",
      severity: "safe",
      title: "No red flags detected in the patterns checked",
      summary: "لم تُطابق أي من قواعد الاكتشاف المدمجة (القوة الغاشمة، حقن SQL/XSS/عبور المسارات، فحص المنافذ، نفق DNS، PowerShell المشفّر) في هذا المقتطف.",
      explanation: "هذا يغطي فقط الأنماط الشائعة والمعروفة جيداً — وليس بديلاً عن ربط بيانات SIEM كامل أو قراءة محلل مدرَّب للشذوذات الخاصة بالسياق.",
      recommendation: "إن كنت تشتبه بشيء محدد، تحقق مما إذا كانت الأسطر ذات الصلة وصلت فعلياً ضمن ما لصقته، وما إذا كانت الصيغة تطابق أحد الأدلة أعلاه.",
      lines: [],
    });
  }

  return { parsed, findings };
}
