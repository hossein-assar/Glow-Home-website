/* ==========================================================================
   Glow Home — catalog, commerce rules and copy.
   This is the ONLY file you edit to change prices, stock or wording.
   Both desktop and phone read from here, so there is nothing to keep in sync.
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. PRICES (تومان)
   PLACEHOLDER NUMBERS — replace the whole block when the official list lands.
   Every id below must also exist in PRODUCTS.
   -------------------------------------------------------------------------- */

let PRICE = {
  // آباژور
  lale: 2850000,
  shiari: 2650000,
  rosha: 3100000,
  delaram: 3250000,
  maha: 3400000,
  deforme: 3300000,
  'deforme-tall': 6900000,
  aghaghia: 3200000,
  'aghaghia-tall': 6600000,
  flower: 2950000,
  tara: 1750000,
  samin: 2600000,
  bozhan: 3050000,
  'gol-o-morgh': 3450000,
  mahgol: 3150000,
  nila: 3350000,
  ava: 3900000,
  roz: 2750000,
  // شمع
  parasto: 320000,
  abrak: 290000,
  baloot: 340000,
  kado: 380000,
  hobabi: 300000,
  aftab: 620000,
  roze: 450000,
  // دکور منزل
  'rosha-set': 1450000,
  circle: 390000,
  raha: 880000,
  'pirex-u': 1250000,
  pirex: 1150000,
};

/* Set to false once the real price list is in and the «موقت» flags
   should disappear from the site. */
let PRICES_ARE_PROVISIONAL = true;

/* --------------------------------------------------------------------------
   2. STOCK
   Add an id here to mark it sold out. Its button becomes «اطلاع از موجودی»
   and routes to the contact form with the piece name filled in.
   -------------------------------------------------------------------------- */

let OUT_OF_STOCK = ['hobabi', 'pirex-u'];

/* --------------------------------------------------------------------------
   3. COLLECTIONS
   -------------------------------------------------------------------------- */

const COLLECTIONS = {
  lamps: {
    fa: 'آباژور',
    en: 'Lamp Shades',
    material: 'سفال',
    blurb: 'با نور گرم و طراحی چشم‌نواز، فضای خانه را دنج‌تر و دلنشین‌تر کنید.',
    cover: 'deforme-tall',
    bannerImg: 'images/banner-lamps.jpg',
  },
  candles: {
    fa: 'شمع',
    en: 'Candle',
    material: 'موم نارگیل',
    blurb: 'ترکیبی از طراحی طبیعی و رایحه‌ای دلنشین برای ساختن فضایی گرم و آرامش‌بخش.',
    cover: 'abrak',
  },
  decor: {
    fa: 'اکسسوری منزل',
    en: 'Home Accessories',
    material: 'پلی‌استر',
    blurb: '<b>خونه، با جزئیات زیباتر میشه</b>',
    cover: 'rosha-set',
  },
  shades: {
    fa: 'شید',
    en: 'Lamp Shades',
    material: 'متقال',
    blurb: 'ظرافت هنر دست، برای روشناییِ گرم و دلنشین خانه شما. 🕊️',
    cover: 'shade-embroidered-cylinder',
  },
};

const MATERIALS = { clay: 'سفال', wax: 'موم نارگیل', poly: 'پلی‌استر', wood: 'چوب', glass: 'شیشه' };

/* Sentinel for a product whose height nobody has confirmed yet — renders as
   «ارتفاع نامشخص» (height unspecified) instead of a fabricated number. */
const HEIGHT_UNKNOWN = 'unknown';

/* --------------------------------------------------------------------------
   4. THE CATALOG
   id · Farsi name · Latin name · collection · height in cm · material · description
   height: use 0 for pieces sold as a set, or a string like '130 / 100 / 80'.
   Photo lookup is images/<id>.png — a piece with no photo file still shows,
   with a placeholder panel instead of a broken image.

   DESCRIPTIONS ARE DRAFTS. They are written from the catalog specs, not from
   the studio's own words — please rewrite before launch.
   -------------------------------------------------------------------------- */

let PRODUCTS = [
  {
    id: 'lale', fa: 'لاله', en: 'Lale', col: 'lamps', height: 55, material: 'clay',
    desc: 'فرم گلبرگی و باز، الهام‌گرفته از گل لاله. بدنه‌ی سفالی نور را از لبه‌ها می‌گذراند و روشنایی نرمی روی دیوار می‌سازد.',
  },
  {
    id: 'shiari', fa: 'شیاری', en: 'Shiari', col: 'lamps', height: 50, material: 'clay',
    desc: 'شیارهای عمودی که دور تا دور بدنه با دست کشیده شده‌اند. نور از میان شیارها بیرون می‌زند و خط‌های باریکی روی سطح اطراف می‌اندازد.',
  },
  {
    id: 'rosha', fa: 'روشا', en: 'Rosha', col: 'lamps', height: 60, material: 'clay',
    desc: 'بدنه‌ی ساده و کشیده با سطح مات. یکی از پرکاربردترین فرم‌های مجموعه، مناسب کنار مبل یا گوشه‌ی اتاق نشیمن.',
  },
  {
    id: 'delaram', fa: 'دل‌آرام', en: 'Delaram', col: 'lamps', height: 60, material: 'clay',
    desc: 'انحنای ملایم بدنه از پایه تا دهانه باز می‌شود. برای فضاهایی که نور غیرمستقیم و آرام می‌خواهند.',
  },
  {
    id: 'maha', fa: 'ماها', en: 'Maha', col: 'lamps', height: 60, material: 'clay',
    desc: 'فرم گرد و کامل با دهانه‌ی جمع. سطح سفال بدون لعاب براق است تا رنگ خاک دیده شود.',
  },
  {
    id: 'deforme', fa: 'دفرمه', en: 'Deforme', col: 'lamps', height: 60, material: 'clay',
    desc: 'بدنه به عمد از تقارن خارج شده، پس هیچ دو قطعه‌ای دقیقاً شبیه هم نیستند. تفاوت جزئی در فرم، بخشی از کار دست است.',
  },
  {
    id: 'deforme-tall', fa: 'دفرمه بلند', en: 'Deforme', col: 'lamps', height: '130 / 100 / 80', material: 'clay',
    desc: 'نسخه‌ی ایستاده‌ی دفرمه در سه بلندی. برای کنار مبل، ورودی یا فضاهای با سقف بلند. ارتفاع را هنگام سفارش در یادداشت بنویسید.',
  },
  {
    id: 'aghaghia', fa: 'اقاقیا', en: 'Aghaghia', col: 'lamps', height: 60, material: 'clay',
    desc: 'بافت ریز و تکرارشونده روی تمام بدنه که با دست روی سفال خام اجرا می‌شود. در نور روشن، سایه‌های ریزی روی خودش می‌اندازد.',
  },
  {
    id: 'flower', fa: 'فلاور', en: 'Flower', col: 'lamps', height: 60, material: 'clay',
    desc: 'دهانه‌ی موج‌دار مثل گلبرگ‌های باز. حجیم‌ترین فرم مجموعه در این ارتفاع.',
  },
  {
    id: 'tara', fa: 'تارا', en: 'Tara', col: 'lamps', height: 30, material: 'clay',
    desc: 'کوچک‌ترین آباژور مجموعه. اندازه‌ی پاتختی و میز کنار تخت، یا در کنار قطعه‌های بلندتر به‌عنوان ست.',
  },

  /* Below this line: pieces identified from photos the studio sent with
     Farsi filenames (their real names), but not part of the original
     22-item list or its "6 missing" note. Height is unknown for all of
     them — HEIGHT_UNKNOWN renders as «ارتفاع نامشخص» rather than a made-up
     number. Fill in the real height, and correct material/collection if
     wrong, before these go live. */
  {
    id: 'aghaghia-tall', fa: 'اقاقیا بلند', en: 'Aghaghia Tall', col: 'lamps', height: HEIGHT_UNKNOWN, material: 'clay',
    desc: 'نسخه‌ی ایستاده‌ی اقاقیا، با همان بافت ریز تکرارشونده روی بدنه‌ی بلندتر.',
  },
  {
    id: 'samin', fa: 'ثمین', en: 'Samin', col: 'lamps', height: HEIGHT_UNKNOWN, material: 'clay',
    desc: 'بدنه‌ی گرد و صاف با رنگ یکدست. سایه‌بان استوانه‌ای ساده روی آن قرار می‌گیرد.',
  },
  {
    id: 'bozhan', fa: 'بوژان', en: 'Bozhan', col: 'lamps', height: HEIGHT_UNKNOWN, material: 'clay',
    desc: 'بدنه‌ی گرد با بافت درشت و لعاب رنگی. یکی از رنگی‌ترین پایه‌های مجموعه.',
  },
  {
    id: 'gol-o-morgh', fa: 'گل و مرغ', en: 'Gol-o-Morgh', col: 'lamps', height: HEIGHT_UNKNOWN, material: 'clay',
    desc: 'نقش برجسته‌ی گل و پرنده روی بدنه‌ی کوزه‌مانند، برگرفته از نقش‌مایه‌ی سنتی گل و مرغ.',
  },
  {
    id: 'mahgol', fa: 'مهگل', en: 'Mahgol', col: 'lamps', height: HEIGHT_UNKNOWN, material: 'clay',
    desc: 'بدنه‌ی گنبدی با بافت ریز تکرارشونده. شبیه اقاقیاست اما با فرم گردتر و بی‌قوس.',
  },
  {
    id: 'nila', fa: 'نیلا', en: 'Nila', col: 'lamps', height: HEIGHT_UNKNOWN, material: 'clay',
    desc: 'همان بدنه‌ی مهگل، با سایه‌بان دو رنگ و طرح لوزی سرمه‌ای. برای کنار دکور آبی و سرمه‌ای.',
  },
  {
    id: 'ava', fa: 'آوا', en: 'Ava', col: 'lamps', height: HEIGHT_UNKNOWN, material: 'wood',
    desc: 'پایه‌ی چوبی گرد به‌جای سفال، با سایه‌بان مخروطی ساده. تنها آباژور چوبی مجموعه.',
  },
  {
    id: 'roz', fa: 'رز', en: 'Roz', col: 'lamps', height: HEIGHT_UNKNOWN, material: 'clay',
    desc: 'سایه‌بان با گل‌های رز کوچک گلدوزی‌شده روی پارچه، روی پایه‌ی نیم‌کره‌ای.',
  },

  {
    id: 'parasto', fa: 'پرستو', en: 'Parasto', col: 'candles', height: 10, material: 'wax',
    desc: 'شمع موم نارگیل در ظرف سرامیکی. موم نارگیل آرام‌تر از پارافین می‌سوزد و دود نمی‌کند.',
  },
  {
    id: 'abrak', fa: 'ابرک', en: 'Abrak', col: 'candles', height: 10, material: 'wax',
    desc: 'سطح ابری و ناهموار روی بدنه‌ی ظرف. پس از تمام‌شدن شمع، ظرف برای جاشمعی یا نگه‌داری زیورآلات می‌ماند.',
  },
  {
    id: 'baloot', fa: 'بلوط', en: 'Baloot', col: 'candles', height: 10, material: 'wax',
    desc: 'فرم بلوط با درپوش جدا. موم نارگیل، فتیله‌ی پنبه‌ای.',
  },
  {
    id: 'kado', fa: 'کادو', en: 'Kado', col: 'candles', height: 10, material: 'wax',
    desc: 'بسته‌بندی‌شده برای هدیه، با روبان و کارت. اگر پیام خاصی می‌خواهید، در یادداشت سفارش بنویسید.',
  },
  {
    id: 'hobabi', fa: 'حبابی', en: 'Hobabi', col: 'candles', height: 10, material: 'wax',
    desc: 'سطح حباب‌دار که در نور شمع، سایه‌های گرد می‌سازد. یکی از پرفروش‌ترین قطعه‌های شمع.',
  },
  {
    id: 'aftab', fa: 'آفتاب‌گردون', en: 'Aftab Gardoon', col: 'candles', height: 30, material: 'wax',
    desc: 'بلندترین شمع مجموعه با فرم آفتاب‌گردان. زمان سوخت بیشتری نسبت به شمع‌های کوچک دارد.',
  },
  {
    id: 'roze', fa: 'رزه', en: 'Roze', col: 'candles', height: 15, material: 'wax',
    desc: 'گلبرگ‌های رز روی تمام بدنه‌ی شمع اجرا شده است. به‌تنهایی یا در ست سه‌تایی روی میز.',
  },

  {
    id: 'rosha-set', fa: 'روشا ست', en: 'Rosha Set', col: 'decor', height: 0, material: 'poly',
    desc: 'ست چندتکه از خانواده‌ی روشا در اندازه‌های مختلف. برای کنسول، میز جلومبلی یا ویترین.',
  },
  {
    id: 'circle', fa: 'سیرکل', en: 'Circle', col: 'decor', height: 10, material: 'poly',
    desc: 'حلقه‌ی توپر پلی‌استر با سطح صاف. به‌تنهایی یا کنار قاب و کتاب روی قفسه.',
  },
  {
    id: 'raha', fa: 'رها', en: 'Raha', col: 'decor', height: 0, material: 'poly',
    desc: 'فرم آزاد و بدون تقارن. هر قطعه در قالب‌گیری کمی متفاوت درمی‌آید.',
  },
  {
    id: 'pirex-u', fa: 'پیرکس U', en: 'Pirex U', col: 'decor', height: 60, material: 'glass',
    desc: 'فرم U بلند با سطح شفاف. بلندترین قطعه‌ی بخش دکور.',
  },
  {
    /* Material corrected from "poly" to "glass" — a photo named
       «جاشمعی پیرکس» (Pyrex candle holder) came in, and Pyrex is a glass
       brand name, not polyester. The photo shows a pair of glass taper
       candlesticks, which is a reasonable fit for a "used together or
       separately" three-height set, but nobody at the studio has confirmed
       it's the same product — hence the badge on the photo. */
    id: 'pirex', fa: 'پیرکس', en: 'Pirex', col: 'decor', height: '25 / 20 / 15', material: 'glass',
    desc: 'ست سه‌تایی پیرکس در سه ارتفاع. با هم یا جدا استفاده می‌شود.',
  },

  /* Waiting on photography — five pieces from the printed catalog are not
     listed yet: Bahar, Dokhtar, Ghisoo, Gift Rose, Lale (candle).
     Aghaghia tall was on this list too but now has a photo — see it further
     up, right after "tara". Add them here with a PRICE entry and they appear
     everywhere at once. */
];

/* Per-product "price still provisional" flags. Defaults every item to the
   sitewide PRICES_ARE_PROVISIONAL flag above, so nothing changes until this
   is overridden — either by hand here, or automatically once the live
   Supabase catalog loads (each product there carries its own flag). */
let PROVISIONAL = Object.fromEntries(PRODUCTS.map((p) => [p.id, PRICES_ARE_PROVISIONAL]));

/* --------------------------------------------------------------------------
   5. SHIPPING, PAYMENT, DISCOUNTS
   -------------------------------------------------------------------------- */

const FREE_SHIP_OVER = 3000000;

// Which of these two applies is decided entirely by شهر at checkout — see
// shippingMethodForCity() in app.js. پست پیشتاز was retired: the
// Tehran-only-پیک / everywhere-else-تیپاکس rule left no city that could
// ever reach it.
const SHIPPING = [
  { id: 'peyk', label: 'پیک تهران', note: 'همان روز، فقط داخل تهران', cost: 90000, payAtDoor: false },
  { id: 'tipax', label: 'تیپاکس', note: 'پس‌کرایه — هزینه را هنگام تحویل می‌پردازید', cost: 0, payAtDoor: true },
];

const PAYMENTS = [
  { id: 'gateway', label: 'درگاه پرداخت آنلاین', note: 'زرین‌پال / آیدی‌پی' },
  { id: 'card', label: 'کارت به کارت', note: 'شماره کارت را می‌فرستیم، فیش را برای ما بفرستید' },
];

const DISCOUNT_CODES = {
  GLOW10: 0.10,
  HANDMADE15: 0.15,
};

/* --------------------------------------------------------------------------
   6. SITE COPY — all drafts, please rewrite in your own voice
   -------------------------------------------------------------------------- */

const COPY = {
  noticeBar: 'سفارشات از ۱۲ تا ۱۶ روز کاری زمان می‌برند، به جز پنجشنبه‌ها و جمعه‌ها',

  heroTitle: 'با گِلو خانه ات را روشن تر کن',
  heroBody:
    '<b>در گِلو، هر گوشه از خانه می‌تواند بازتابی از سلیقه‌ی شما باشد.</b> از آباژور و شیدهای دست‌دوز تا اکسسوری‌های خاص خانه، هر محصول با دقت و عشق ساخته می‌شود. همچنین می‌توانید با انتخاب رنگ، پارچه و جزئیات مورد علاقه‌تان، سفارش خود را مطابق با سلیقه و فضای خانه‌تان شخصی‌سازی کنید.',

  assurances: [
    { icon: 'truck', title: 'ارسال به سراسر کشور', body: 'با خیال راحت سفارشتون رو ثبت کنید؛ ارسال محصولات به سراسر کشور انجام میشه.' },
    { icon: 'package', title: 'بسته بندی ایمن', body: 'سفارش شما با دقت و وسواس بسته‌بندی میشه تا در طول مسیر کاملاً ایمن بمونه و سالم و بدون آسیب به دستتون برسه.' },
    { icon: 'shield', title: 'پرداخت اقساطی با اسنپ پی', body: 'خرید راحت‌تر از همیشه! با امکان پرداخت اقساطی از طریق اسنپ‌پی، می‌تونید محصول مورد علاقتون رو تهیه کنید و هزینه رو در چند مرحله پرداخت کنید.' },
    { icon: 'flame', title: 'سفارش مطابق با سلیقه شما', body: 'هر سفارش می‌تونه دقیقاً مطابق سلیقه و خواست شما آماده بشه. رنگ، طرح و جزئیات مورد نظرتون رو انتخاب کنید تا سفارشی خاص و منحصر‌به‌فرد داشته باشید.' },
  ],

  studioTitle: 'هر قطعه یک‌بار ساخته می‌شود',
  studioBody: 'کار با سفال یعنی هیچ دو قطعه‌ای کاملاً یکسان درنمی‌آید. تفاوت جزئی در رنگ خاک، بافت سطح یا انحنای بدنه ایراد نیست؛ نشانه‌ی این است که قطعه با دست ساخته شده.',

  aboutTitle: 'درباره ما',
  aboutBody: [
    'مجموعه گِلو هوم (Glow Home) فعالیت خود را از سال ۱۴۰۳ جهت فروش آنلاین آباژور و شیدهای گلدوزی و دکوری خانه و شمع دست‌ساز آغاز نموده است.',
    'باور داریم زیبایی در جزئیات است؛ برای همین تلاش می‌کنیم هر قطعه با کیفیت، ظرافت و حس‌وحال خاص خودش ساخته شود. همچنین می‌توانید رنگ، پارچه و جزئیات بعضی از محصولات را مطابق سلیقه و فضای خانه‌تان انتخاب کنید.',
  ],
  aboutStats: [
    { value: '۲۲', label: 'قطعه در مجموعه‌ی فعلی' },
    { value: '۳', label: 'خانواده‌ی محصول' },
    { value: '۱۰۰٪', label: 'ساخت استودیو' },
  ],

  faq: [
    {
      q: 'ارسال از کجاست؟',
      a: 'تهران',
    },
    {
      q: 'مدت زمان آماده‌سازی سفارش چقدر است؟',
      a: 'کارهای با شید ساده ۱۲ تا ۱۵ روز کاری آماده می‌شوند (پنجشنبه و جمعه جزو روزهای کاری نیستند). کارهای گلدوزی <b>۱۵ تا ۱۸ روز کاری</b> زمان آماده‌سازی دارند.',
    },
    {
      q: 'آباژور با رنگ خاص قابل سفارش است؟',
      a: 'بله، امکان انتخاب رنگ پایه و رنگ شید وجود دارد.',
    },
    {
      q: 'با چه روشی ارسال می‌شود؟',
      a: 'برای خارج از تهران با <b>تیپاکس</b> ارسال می‌شود. ارسال داخل تهران با <b>پیک</b> انجام می‌شود.',
    },
    {
      q: 'پرداخت اقساطی دارید؟',
      a: 'بله، امکان پرداخت اقساطی با <b>اسنپ پی</b> وجود دارد.',
    },
    {
      q: 'خرید اقساطی باعث افزایش قیمت می‌شود؟',
      a: 'خیر، خرید اقساطی <b>هیچ افزایش قیمتی ندارد.</b>',
    },
    {
      q: 'عکس‌های سایت ژورنالی هستند؟',
      a: 'خیر. تمام عکس‌های موجود در سایت، <b>عکاسی خودِ مجموعه هستند و از محصولات خودمان گرفته شده‌اند</b>.',
    },
  ],

  contactIntro: 'برای سفارش خاص، سوال درباره‌ی موجودی یا هر چیز دیگری بنویسید. معمولاً ظرف یک روز کاری پاسخ می‌دهیم.',
  contactHours: 'شنبه تا چهارشنبه (به غیر از تعطیلات رسمی)',
  contactPhone: '۰۹۱۹۵۸۱۹۲۰۳',
  instagram: 'glow.home__',
  instagramUrl: 'https://www.instagram.com/glow.home__?stkn=MXViNXFlZHN5aXAyNg==',

  footerBlurb: 'آباژورهای دست‌ساز، شمع‌های گلدوزی\nاکسسوری منزل',
  footerBase: 'این نسخه‌ی نمایشی طراحی است. قیمت‌ها موقت‌اند و هیچ سفارشی ثبت یا پرداختی انجام نمی‌شود.',
};
