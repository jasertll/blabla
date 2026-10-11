/**
 * JOSINT · PDF Toolkit — تعريف الأدوات وحقول خياراتها
 * تعريف تصريحي حتى تبقى الواجهة نحيفة وإضافة أداة جديدة سطراً واحداً.
 */

import type { ToolId } from '../../lib/pdf/runner';

export type FieldKind = 'select' | 'text' | 'password' | 'number' | 'checkbox' | 'note';

export interface Field {
  kind: FieldKind;
  key: string;
  label?: string;
  placeholder?: string;
  options?: Array<[string, string]>;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  /** يظهر الحقل فقط إذا تحققت الشرط */
  showIf?: (v: Record<string, unknown>) => boolean;
  /** نص إرشادي */
  hint?: string;
}

export interface ToolDef {
  id: ToolId;
  icon: string;
  name: string;
  desc: string;
  /** مجموعة العرض في الشبكة */
  group: 'أمان وخصوصية' | 'تحرير الصفحات' | 'استخراج وتحليل';
  /** يقبل عدة ملفات */
  multi?: boolean;
  /** يقبل صوراً بدل PDF */
  accepts?: 'pdf' | 'image';
  /** يعرض فحصاً تمهيدياً للعلامات المائية */
  prescan?: boolean;
  /** لا يعمل إلا في المتصفح (canvas / عامل) */
  heavy?: boolean;
  fields?: Field[];
}

export const TOOLS: ToolDef[] = [
  /* ------------------ أمان وخصوصية ------------------ */
  {
    id: 'remove-watermark',
    icon: '🧽',
    name: 'إزالة العلامة المائية',
    desc: 'حذف العلامات المائية مع الحفاظ الكامل على النص الأصلي تحتها',
    group: 'أمان وخصوصية',
    prescan: true,
    fields: [
      {
        kind: 'select', key: 'mode', label: 'طريقة الإزالة', default: 'auto',
        options: [
          ['auto', 'تلقائي — الأكثر أماناً (موصى به)'],
          ['text', 'إزالة نص محدد'],
          ['aggressive', 'متقدم — يشمل العناصر المتكررة'],
        ],
      },
      {
        kind: 'text', key: 'text', label: 'نص العلامة المائية',
        placeholder: 'مثال: CONFIDENTIAL',
        showIf: (v) => v.mode === 'text',
      },
      {
        kind: 'select', key: 'alpha', label: 'حساسية الشفافية', default: '0.7',
        options: [
          ['0.5', 'متحفّظة — الشفاف جداً فقط'],
          ['0.7', 'متوازنة (موصى به)'],
          ['0.9', 'عالية — تشمل الباهت قليلاً'],
        ],
      },
      { kind: 'checkbox', key: 'removeImages', label: 'إزالة الصور المتكررة في كل الصفحات', default: true },
      {
        kind: 'note', key: 'warn',
        label: 'الوضع المتقدم قد يزيل ترويسة أو تذييلاً ثابتاً يتكرر في كل الصفحات — استخدمه فقط إذا لم ينجح الوضع التلقائي.',
        showIf: (v) => v.mode === 'aggressive',
      },
    ],
  },
  {
    id: 'protect',
    icon: '🔒',
    name: 'حماية بكلمة مرور',
    desc: 'تشفير الملف بحيث لا يُفتح إلا بكلمة مرور',
    group: 'أمان وخصوصية',
    fields: [
      { kind: 'password', key: 'password', label: 'كلمة المرور', placeholder: '••••••••' },
      { kind: 'password', key: 'ownerPassword', label: 'كلمة مرور المالك (اختياري)' },
      { kind: 'checkbox', key: 'allowPrinting', label: 'السماح بالطباعة', default: true },
      { kind: 'checkbox', key: 'allowCopying', label: 'السماح بنسخ النص', default: true },
      { kind: 'checkbox', key: 'allowModifying', label: 'السماح بالتعديل', default: false },
    ],
  },
  {
    id: 'unlock',
    icon: '🔓',
    name: 'إزالة الحماية',
    desc: 'فك تشفير ملف محمي أو رفع قيود الصلاحيات',
    group: 'أمان وخصوصية',
    fields: [
      {
        kind: 'password', key: 'password', label: 'كلمة المرور الحالية',
        placeholder: 'اتركها فارغة إن كان الملف مقيّداً بلا كلمة مرور',
      },
    ],
  },
  {
    id: 'watermark',
    icon: '💧',
    name: 'إضافة علامة مائية',
    desc: 'نص مخصص بأي لغة، بشفافية وميلان وحجم قابل للضبط',
    group: 'أمان وخصوصية',
    fields: [
      { kind: 'text', key: 'text', label: 'النص', default: 'JOSINT', placeholder: 'نسخة تجريبية' },
      {
        kind: 'select', key: 'opacity', label: 'الشفافية', default: '0.15',
        options: [['0.08', 'خفيفة جداً'], ['0.15', 'خفيفة'], ['0.25', 'متوسطة'], ['0.4', 'قوية']],
      },
      {
        kind: 'select', key: 'rotate', label: 'الميلان', default: '45',
        options: [['0', 'أفقي'], ['45', '45°'], ['90', 'عمودي']],
      },
    ],
  },

  /* ------------------ تحرير الصفحات ------------------ */
  {
    id: 'merge',
    icon: '🔗',
    name: 'دمج ملفات',
    desc: 'دمج عدة ملفات PDF في ملف واحد بالترتيب',
    group: 'تحرير الصفحات',
    multi: true,
  },
  {
    id: 'split',
    icon: '✂️',
    name: 'تقسيم',
    desc: 'كل صفحة في ملف، أو كل N صفحات، أو نطاقات محددة',
    group: 'تحرير الصفحات',
    fields: [
      {
        kind: 'select', key: 'mode', label: 'طريقة التقسيم', default: 'each',
        options: [['each', 'كل صفحة في ملف'], ['every', 'كل N صفحات في ملف'], ['range', 'نطاقات محددة']],
      },
      {
        kind: 'number', key: 'every', label: 'عدد الصفحات لكل ملف', default: 2, min: 1,
        showIf: (v) => v.mode === 'every',
      },
      {
        kind: 'text', key: 'ranges', label: 'النطاقات', placeholder: '1-3,5,8-10',
        showIf: (v) => v.mode === 'range',
      },
    ],
  },
  {
    id: 'extract-pages',
    icon: '📄',
    name: 'استخراج صفحات',
    desc: 'استخراج صفحات محددة إلى ملف جديد',
    group: 'تحرير الصفحات',
    fields: [{ kind: 'text', key: 'pages', label: 'الصفحات', placeholder: '1-3,5,8-10' }],
  },
  {
    id: 'delete-pages',
    icon: '🗑️',
    name: 'حذف صفحات',
    desc: 'إزالة صفحات محددة من الملف',
    group: 'تحرير الصفحات',
    fields: [{ kind: 'text', key: 'pages', label: 'الصفحات', placeholder: '2,5,9' }],
  },
  {
    id: 'rotate',
    icon: '🔄',
    name: 'تدوير',
    desc: 'تدوير كل الصفحات أو صفحات محددة',
    group: 'تحرير الصفحات',
    fields: [
      {
        kind: 'select', key: 'angle', label: 'الزاوية', default: '90',
        options: [['90', '90° يمين'], ['180', '180°'], ['270', '90° يسار']],
      },
      {
        kind: 'text', key: 'pages', label: 'صفحات محددة (اختياري)',
        placeholder: 'اتركه فارغاً لكل الصفحات',
      },
    ],
  },
  {
    id: 'page-numbers',
    icon: '🔢',
    name: 'ترقيم الصفحات',
    desc: 'إضافة أرقام صفحات تلقائية في أي موضع',
    group: 'تحرير الصفحات',
    fields: [
      {
        kind: 'select', key: 'position', label: 'الموضع', default: 'bottom-center',
        options: [
          ['bottom-center', 'أسفل — وسط'], ['bottom-right', 'أسفل — يمين'],
          ['bottom-left', 'أسفل — يسار'], ['top-center', 'أعلى — وسط'],
          ['top-right', 'أعلى — يمين'], ['top-left', 'أعلى — يسار'],
        ],
      },
      { kind: 'number', key: 'start', label: 'رقم البداية', default: 1, min: 0 },
    ],
  },
  {
    id: 'compress',
    icon: '🗜️',
    name: 'ضغط',
    desc: 'تصغير حجم الملف — وضع آمن يحافظ على النص ووضع قوي',
    group: 'تحرير الصفحات',
    heavy: true,
    fields: [
      {
        kind: 'select', key: 'mode', label: 'الوضع', default: 'safe',
        options: [['safe', 'آمن — يحافظ على النص'], ['strong', 'قوي — يحوّل الصفحات إلى صور']],
      },
      {
        kind: 'select', key: 'level', label: 'مستوى الضغط', default: 'medium',
        options: [['high', 'خفيف — أعلى جودة'], ['medium', 'متوازن'], ['low', 'أقصى ضغط']],
      },
      {
        kind: 'note', key: 'w',
        label: 'الوضع القوي يفقد النص القابل للبحث — استخدمه فقط عند الحاجة الشديدة لتصغير الحجم.',
        showIf: (v) => v.mode === 'strong',
      },
    ],
  },
  {
    id: 'images-to-pdf',
    icon: '📚',
    name: 'صور إلى PDF',
    desc: 'تجميع عدة صور في ملف PDF واحد',
    group: 'تحرير الصفحات',
    multi: true,
    accepts: 'image',
  },

  /* ------------------ استخراج وتحليل ------------------ */
  {
    id: 'forensics',
    icon: '🔬',
    name: 'فحص جنائي وبيانات وصفية',
    desc: 'مؤشرات الخطورة، أداة الإنشاء، الروابط، الملفات المرفقة، الخطوط',
    group: 'استخراج وتحليل',
  },
  {
    id: 'extract-text',
    icon: '📝',
    name: 'استخراج النص',
    desc: 'سحب كل النص القابل للتحديد صفحةً صفحة',
    group: 'استخراج وتحليل',
  },
  {
    id: 'extract-images',
    icon: '🖼️',
    name: 'استخراج الصور',
    desc: 'سحب كل الصور المضمّنة داخل الملف',
    group: 'استخراج وتحليل',
  },
  {
    id: 'to-images',
    icon: '📷',
    name: 'تحويل الصفحات إلى صور',
    desc: 'كل صفحة كصورة PNG أو JPG بأي دقة',
    group: 'استخراج وتحليل',
    heavy: true,
    fields: [
      {
        kind: 'select', key: 'format', label: 'الصيغة', default: 'png',
        options: [['png', 'PNG — بلا فقدان'], ['jpg', 'JPG — أصغر حجماً']],
      },
      {
        kind: 'select', key: 'dpi', label: 'الدقة (DPI)', default: '150',
        options: [['100', '100 — سريع'], ['150', '150 — متوسط'], ['200', '200 — جيد'], ['300', '300 — طباعة']],
      },
    ],
  },
  {
    id: 'ocr',
    icon: '🔍',
    name: 'OCR — قراءة النص من الصور',
    desc: 'استخراج النص من ملفات ممسوحة ضوئياً (عربي وإنجليزي)',
    group: 'استخراج وتحليل',
    heavy: true,
    fields: [
      {
        kind: 'select', key: 'lang', label: 'اللغة', default: 'ara+eng',
        options: [['ara+eng', 'عربي + إنجليزي'], ['ara', 'عربي'], ['eng', 'إنجليزي']],
      },
      {
        kind: 'select', key: 'dpi', label: 'الدقة', default: '180',
        options: [['150', '150 — أسرع'], ['180', '180 — متوازن'], ['300', '300 — أدق']],
      },
      {
        kind: 'note', key: 'n',
        label: 'يُحمَّل محرك التعرّف الضوئي عند أول استخدام (بضعة ميجابايت)، ثم يعمل كلياً داخل متصفحك.',
      },
    ],
  },
];

export const GROUPS = ['أمان وخصوصية', 'تحرير الصفحات', 'استخراج وتحليل'] as const;

export function toolById(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** القيم الافتراضية لحقول أداة */
export function defaultsFor(tool: ToolDef): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of tool.fields ?? []) {
    if (f.kind === 'note') continue;
    if (f.default !== undefined) out[f.key] = f.default;
    else if (f.kind === 'checkbox') out[f.key] = false;
    else out[f.key] = '';
  }
  return out;
}
