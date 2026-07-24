/**
 * Sera Bütçe — Maşyn Yzarlama → Daşary Sertnamalary → Invoice / Alyjylar
 * sub-tab mock data. Transcribed verbatim from sera-ref/41 (Invoice Arhiwi)
 * and sera-ref/42 (Alyjy firmalar directory). UI-only prototype — no API.
 */

// ─── Invoice Arhiwi ─────────────────────────────────────────────────────
export interface InvoiceRow {
  readonly exportCode: string | null;
  readonly date: string;
  readonly invoiceNo: string | null;
  readonly exportFirm: string;
  readonly importFirm: string | null;
  readonly mestaSany: number;
  readonly bruttoKg: number;
  readonly nettoKg: number;
  readonly unitPrice: number | null;
  readonly tutaryUsd: number | null;
}

export const INVOICE_ROWS: readonly InvoiceRow[] = [
  { exportCode: '23JL001/26', date: '2026-07-23', invoiceNo: null, exportFirm: 'Yigit', importFirm: null, mestaSany: 3500, bruttoKg: 18100, nettoKg: 18000, unitPrice: null, tutaryUsd: null },
  { exportCode: null, date: '2026-07-23', invoiceNo: null, exportFirm: 'Hemsaya', importFirm: null, mestaSany: 3400, bruttoKg: 18200, nettoKg: 18000, unitPrice: null, tutaryUsd: null },
  { exportCode: null, date: '2026-07-23', invoiceNo: null, exportFirm: 'Yigit', importFirm: 'Aranşy - KZ', mestaSany: 3333, bruttoKg: 17200, nettoKg: 17000, unitPrice: null, tutaryUsd: null },
];

export const INVOICE_EXPORT_FIRMS: readonly string[] = ['Hemsaya', 'Yigit'];
export const INVOICE_IMPORT_FIRMS: readonly string[] = ['Aranşy - KZ'];

// ─── Alyjy firmalar (buyer directory) ───────────────────────────────────
export interface AlyjyFirm {
  readonly name: string;
  readonly nameTm: string;
  readonly nameRu: string;
  readonly addressTm: string;
  readonly addressRu: string;
  readonly bin: string | null;
  readonly kpp: string | null;
  readonly ogrn: string | null;
  readonly directorTm: string;
  readonly directorRu: string;
  readonly bankNameTm: string | null;
  readonly bankNameRu: string | null;
  readonly bankAddressTm: string | null;
  readonly bankAddressRu: string | null;
  readonly bik: string | null;
  readonly acctKztRub: string | null;
  readonly acctUsd: string | null;
  readonly acctRub: string | null;
}

export const ALYJY_FIRMS: readonly AlyjyFirm[] = [
  {
    name: 'Nur-Alem',
    nameTm: '«Nur-Alem» JÇB', nameRu: 'TOO «Нур-Алем»',
    addressTm: 'Gazagystan Respublikasy, Şymkent şäheri, Karatau etraby, Nursat ýaşaýyş massiwleri, 29/2 jaýy, 2 korpusy, 59 öýi, 160023 poçta indeksi',
    addressRu: 'Республика Казахстан, город Шымкент, район Каратау, Жилой массив Нурсат, дом 29/2, корпус 2, кв. 59, почтовый индекс 160023',
    bin: '111040014926', kpp: null, ogrn: 'RNN: 581200221005',
    directorTm: 'Direktor Ilýaewa D.N', directorRu: 'Директор Иляева Д.Н',
    bankNameTm: 'АО «KASPI BANK» Şymkent', bankNameRu: 'АО «KASPI BANK» Шымкент',
    bankAddressTm: null, bankAddressRu: null, bik: 'CASPKZKA',
    acctKztRub: null, acctUsd: 'KZ67722S000000643940', acctRub: null,
  },
  {
    name: 'ŞAHFRUKT',
    nameTm: '«ŞAHFRUKT» JÇJ', nameRu: 'ООО «ШАХФРУКТ»',
    addressTm: 'Odinsow 143032, Russiýa, Odinsowskiý ş. Gorki- 10 p.d-23 ýer 7N',
    addressRu: 'Одинцово, 143032, РОССИЯ, Одинцовский г.о., Горки-10 п. д. 23 помещ. 7Н,',
    bin: '9725157100', kpp: '772501001', ogrn: '1247700319591',
    directorTm: 'Direktor Balmuhammedow Ş.', directorRu: 'Директор Балмухаммедов. Ш',
    bankNameTm: 'AO «НДБАНК»', bankNameRu: 'АО «НДБАНК»',
    bankAddressTm: 'г. МОСКВА', bankAddressRu: 'ş. Moskwa', bik: '044525182',
    acctKztRub: '40702810300000001353', acctUsd: '30101810445250000182', acctRub: '40702810300000001353',
  },
  {
    name: 'TURKMENFRUKT',
    nameTm: 'JÇJ «TÜRKMENFRUKT»', nameRu: 'ООО "ТУРКМЕНФРУКТ"',
    addressTm: '105264, ş. Moskwa, w.ter.g. munisipalnyý okrug Izmaýlowo, köçe Werhnaýa Perwomaýskaýa, j. 45A, pomej. 12/4',
    addressRu: '105264, г. Москва, вн.тер.г. муниципальный округ Измайлово, ул.,Верхняя Первомайская, д. 45А, помещ. 12/4',
    bin: '9719072674', kpp: '771901001', ogrn: '1247700656180 с 03.10.2024',
    directorTm: 'Direktor Allajykow T', directorRu: 'Директор Алладжыков Т.',
    bankNameTm: 'PAO Sberbank', bankNameRu: 'ПАО Сбербанк',
    bankAddressTm: null, bankAddressRu: null, bik: '044525225',
    acctKztRub: null, acctUsd: '40702810238000517317', acctRub: '40702810238000517317',
  },
  {
    name: 'TransAsia Trade',
    nameTm: '«TransAsia Trade» JÇB-sy', nameRu: 'ТОО «TransAsia Trade»',
    addressTm: 'GR, Almata welaýaty, şäher Konaýew, köç. Industrialnaýa, jaý 9, poç. indeksy 040800 BIN: 170540030141',
    addressRu: 'РК, Алматинская область, город Қонаев, улица Индустриальная, здание 9, поч.инд. 040800',
    bin: '170540030141', kpp: null, ogrn: null,
    directorTm: 'Direktor Kurmanbek M. I', directorRu: 'Директор Курманбек М. И',
    bankNameTm: 'AO «BEREKE BANK»', bankNameRu: 'АО «BEREKE BANK»',
    bankAddressTm: null, bankAddressRu: null, bik: 'BRKEKZKA XXX',
    acctKztRub: null, acctUsd: 'KZ70914122203US001EE', acctRub: null,
  },
  {
    name: 'Hususy telekeçi Tursynbaýew',
    nameTm: 'Hususy telekeçi Tursynbaýew', nameRu: 'ИП ТУРСЫНБАЕВ',
    addressTm: 'GR, Turkestan etr., Saryagaş welaýaty, Saryagaş oba, A. Aralbekow köç.,jaý 4. UGD Saryagaş welaýaty.',
    addressRu: 'РК, Туркестанская обл.,Сарыагашский район, с.Сарыагаш, ул.А.Аралбеков, д.4 УГД по Сарыагашскому району',
    bin: '930925301724', kpp: null, ogrn: null,
    directorTm: 'Direktor Hususy telekeçi Tursynbaýew O.B', directorRu: 'Директор ИП Турсынбаев О.Б',
    bankNameTm: 'AO «ForteBank» ş. Şymklent', bankNameRu: 'АО " ForteBank" г.Шымкент',
    bankAddressTm: null, bankAddressRu: null, bik: 'IRTYKZKA',
    acctKztRub: 'KZ0296516F0011652109 (KZT)', acctUsd: 'KZ7296516F0011652110', acctRub: null,
  },
  {
    name: 'Aranşy - KZ',
    nameTm: '«Aranşy - KZ» JÇB', nameRu: 'TOO «Араншы - KZ»',
    addressTm: 'GR, Türküstan welaýaty, Kelesskiý etrap, Koşkaratinskliý s.o., Perwoýe Maýa obasy, T.Bigeldinow köçesi, 2/A',
    addressRu: 'РК, Туркестанская область, Келесский район, Кошкаратинский с.о., с. Первое Мая, ул. Т. Бигелдинов 2/А',
    bin: '191040016779', kpp: null, ogrn: null,
    directorTm: 'Direktor Tuktibaýew Bekjan', directorRu: 'Директор Туктибаев Бекжан',
    bankNameTm: '«Narodnyý Bank Kazahstana» PJ', bankNameRu: 'АО "Народный Банк Казахстана"',
    bankAddressTm: null, bankAddressRu: null, bik: 'HSBKKZKX',
    acctKztRub: null, acctUsd: 'KZ97601A891001387241', acctRub: null,
  },
  {
    name: 'Glavryba',
    nameTm: '"Glavryba" JÇJ', nameRu: 'ОсОО "Главрыба"',
    addressTm: 'Bishkek ş., Sverdlovskiy etrap, köçe Moskovskaya j 39 otag 8',
    addressRu: 'г. Бишкек, Свердловский р-н, ул. Московская д. 39 кв. 8',
    bin: '02908202510507', kpp: null, ogrn: null,
    directorTm: 'Direktor Shadrina M. V', directorRu: 'Директор Шадрина М. В',
    bankNameTm: 'OAO «Komercheskiy bank Kyrgyzstan» Gyrgyz Respublikasy', bankNameRu: 'ОАО «Комерческий банк Кыргызстан» Кыргызская Республика',
    bankAddressTm: null, bankAddressRu: 'KYRSKG22', bik: '103021',
    acctKztRub: null, acctUsd: null, acctRub: null,
  },
  {
    name: 'Winta Plus',
    nameTm: '"Winta Plus" JÇJ', nameRu: 'ОсОО "Винта Плюс"',
    addressTm: 'Hukuk salgysy: Gyrgyzystan respublikasy, Çui sebiti, Issyk-Atinskiý etraby, Kant, köç. Molodeznaýa, 2',
    addressRu: 'Юридический адрес: Кыргызкая Республика, Чүйская облусу, Ысык-Атинский район, Кант, ул. Молодёжная , 2, 2',
    bin: '01604202510383', kpp: null, ogrn: null,
    directorTm: 'Direktor Lemeza Anwar L', directorRu: 'Директор ЛЕМЕЗА АНВАР Л',
    bankNameTm: 'Kompanion Bank CJSC Bishkek, Shota Rustaveli', bankNameRu: 'Kompanion Bank CJSC Bishkek, Shota Rustaveli',
    bankAddressTm: null, bankAddressRu: null, bik: 'KOMPKG22',
    acctKztRub: null, acctUsd: null, acctRub: null,
  },
  {
    name: 'Krasnyý apelsin',
    nameTm: '"Krasnyý apelsin" JÇJ', nameRu: 'ОсОО "КРАСНЫЙ АПЕЛЬСИН"',
    addressTm: 'Gyrgyzystan Respublikasy, ş.Bişkek, köç Frunze,300,108',
    addressRu: 'Кыргызская Республика, г Бишкек,ул Фрунзе,300,108',
    bin: '02911202110038', kpp: null, ogrn: null,
    directorTm: 'Direktor Sadybakasow A.A', directorRu: 'Директор Садыбакасов А.А',
    bankNameTm: 'OAO «BAKAÝ BANK»', bankNameRu: 'ОАО «БАКАЙ БАНК»',
    bankAddressTm: 'Gyrgyzystan Respublikasy, ş.Bişkek, köç Mkrn.Asanbaý,8/2', bankAddressRu: 'Кыргызская Республика, г.Бишкек, ул.Мкрн.Асанбай,8/2',
    bik: '124018', acctKztRub: null, acctUsd: null, acctRub: null,
  },
  {
    name: 'Dar zemli',
    nameTm: '«Dar zemli» JÇJ', nameRu: 'ООО «Дар земли»',
    addressTm: '17292, Moskwa, Şwernika köçesi, kw. 6-njy jaý 1, otag 6p',
    addressRu: '117292, город Москва, ул Шверника, д. 6 к. 1, помещ. 6п',
    bin: '9727120233/ 772701001', kpp: '9727120233/ 772701001', ogrn: '1257700536279',
    directorTm: 'Direktor Wolk Wladislaw M', directorRu: 'Директор Вовк Владислав Михайлович',
    bankNameTm: 'AO «Alfa Bank»', bankNameRu: 'АО «АЛЬФА-БАНК»',
    bankAddressTm: null, bankAddressRu: null, bik: '044525593',
    acctKztRub: '40702810801300054442', acctUsd: '40702840701300009444', acctRub: '40702810801300054442',
  },
  {
    name: 'Manufaktura',
    nameTm: '« Manufaktura » JÇJ', nameRu: 'ООО «Мануфактура»',
    addressTm: '09316, Moskwa, Içerki territoriýa, Nihniý Nowgorod şäher etraby, Wolgogradskiý şaýoly, Bldg 35',
    addressRu: '109316, Г.МОСКВА, ВН.ТЕР.Г. МУНИЦИПАЛЬНЫЙ ОКРУГ НИЖЕГОРОДСКИЙ, ПР-КТ ВОЛГОГРАДСКИЙ, Д. 35',
    bin: '7724187003', kpp: '770501001', ogrn: '1145009004513',
    directorTm: 'Direktor Mirahmedow R.K', directorRu: 'Директор МИРАХМЕДОВ Р. К',
    bankNameTm: 'Aziya-Invest Bank', bankNameRu: 'Азия-Инвест Банк (АО)',
    bankAddressTm: null, bankAddressRu: null, bik: '044525234',
    acctKztRub: '40702810500000020068', acctUsd: '30101810445250000234', acctRub: '40702810500000020068',
  },
  {
    name: 'Eko-Bay Kerji',
    nameTm: '"Eko-Bay Kerji" JÇJ', nameRu: 'ОсОО "ЭКО-БАЙ КЕЙДЖИ"',
    addressTm: 'Gyrgyzstan Respulikasy, ş. Bişkek Leninskiý etrap, köçe Kupýansk, 13',
    addressRu: 'Кыргызская Республика, город Бишкек, Ленинский район, ул. Купянск, 13',
    bin: '00509202510026', kpp: null, ogrn: null,
    directorTm: 'Direktor Oskoialiýew B.B', directorRu: 'Директор Оскоиалиев Б.Б.',
    bankNameTm: null, bankNameRu: null,
    bankAddressTm: null, bankAddressRu: null, bik: 'KOMPKG22',
    acctKztRub: null, acctUsd: '24100639156900', acctRub: null,
  },
  {
    name: 'Aries Layn',
    nameTm: '"Aries Layn" JÇJ', nameRu: 'ОсОО "Ариес Лайн"',
    addressTm: 'Gyrgyz Respublikasy, Bişkek, Swerdlowsk etraby, Çui şaýoly, 127, 136',
    addressRu: 'Кыргызская Республика, Бишкек Свердловский район, пр.Чуй, 127, 136',
    bin: '01501202610223', kpp: null, ogrn: null,
    directorTm: 'Direktor Kenjeyewa T.O', directorRu: 'Директор Кенжеева Т.О',
    bankNameTm: null, bankNameRu: null,
    bankAddressTm: null, bankAddressRu: null, bik: 'KOMPKG22',
    acctKztRub: null, acctUsd: '21002840500000348001', acctRub: null,
  },
  {
    name: 'MTLK Ishenim',
    nameTm: '"MTLK Ishenim" JÇJ', nameRu: 'ОсОО "МТЛК Ишеним"',
    addressTm: 'Gyrgyz Respublikasy, Bişkek şäheri, Swedlowsk etraby, Zhibek zholu köçesi, jaý 204.',
    addressRu: 'Кыргызская Республика, город Бишкек, Свердловский район, улица Жибек Жолу, дом 204',
    bin: '01605202410080', kpp: null, ogrn: null,
    directorTm: 'Direktor Abdybekow.A A', directorRu: 'Директор Абдыбеков A. A',
    bankNameTm: 'OAO "BAKAY BANK", Bişkek, Gyrgyz Respublikasy', bankNameRu: 'ОАО «БАКАЙ БАНК», г. Бишкек, Кыргызская Республика',
    bankAddressTm: null, bankAddressRu: null, bik: null,
    acctKztRub: null, acctUsd: '1240020001624047', acctRub: null,
  },
  {
    name: 'AOM Ekotreýd',
    nameTm: '"AOM Ekotreýd" JÇJ', nameRu: 'ОсОО «АОМ Экотрейд»',
    addressTm: 'Gyrgyzystan Respublikasy, Bişkek şäheri, Turusbekowa köç., 109/3',
    addressRu: 'Республика Кыргызстан, г. Бишкек, ул. Турусбекова 109/3',
    bin: '02202202110363', kpp: null, ogrn: null,
    directorTm: 'Direktor Ryzyh A.A', directorRu: 'Директор Рыжих А.А.',
    bankNameTm: '«Optima Bank» APJ, Bişkek ş No-3', bankNameRu: 'ОАО «Оптима Банк» г.Бишкек №3',
    bankAddressTm: null, bankAddressRu: null, bik: '109014',
    acctKztRub: null, acctUsd: null, acctRub: null,
  },
  {
    name: 'Jana Gasir',
    nameTm: '«Jana Gasir 111» JÇB-ti', nameRu: 'ТОО "Jana Gasir 111"',
    addressTm: 'RK, Türküstan sebiti, Saryagaş etraby, Saryagaş şäheri, A.Abduhalykow köçesi, 12kv jaý',
    addressRu: 'РК, Туркестанская область, Сарыагашский район, Г Сарыагаш, улица А. Абдухалыкова, дом № 12кв',
    bin: '240740035988', kpp: null, ogrn: null,
    directorTm: 'Direktor Dauylow K.S', directorRu: 'Директор Дауылов К.С',
    bankNameTm: 'PJ Bereke bank', bankNameRu: 'АО Bereke bank',
    bankAddressTm: 'Maglumaty PJ «Bank SentrKredit»', bankAddressRu: 'Реквизиты АО «Банк ЦентрКредит»',
    bik: 'KCJBKZKX', acctKztRub: 'KZ738562203139548972', acctUsd: null, acctRub: null,
  },
  {
    name: 'Tauminoti Aulo',
    nameTm: '"Tauminoti Aulo" JÇJ', nameRu: 'LLC "Tauminoti Aulo"',
    addressTm: 'Täjikistan Respublikasy, Dushanbe şäheri, Somoni etraby, I. Somoni köçe, 10/1',
    addressRu: 'Republic of Tajikistan, Dushanbe, Somoni district, Street I.Somoni 10/1',
    bin: null, kpp: null, ogrn: null,
    directorTm: 'Direktor Abdulloýew R.M', directorRu: 'Director Abdulloev R.M',
    bankNameTm: 'CJSC "International Bank of Tajikistan"', bankNameRu: 'CJSC "International Bank of Tajikistan"',
    bankAddressTm: '27, Bukhoro Str., Dushanbe, Tajikistan', bankAddressRu: '27, Bukhoro Str., Dushanbe, Tajikistan',
    bik: '350101803', acctKztRub: null, acctUsd: '20202972700011610001', acctRub: null,
  },
  {
    name: 'SUNDAY TEAM',
    nameTm: '« SUNDAY TEAM » JÇJ-ti', nameRu: 'OОО «SUNDAY TEAM»',
    addressTm: 'Uzbekistan Respublikasy, ş. Taşkent, etrap Bektemirskiý, Nurly ýyl MFÝ, köçe Mehnatobod-82',
    addressRu: 'Республика Узбекистан, город Ташкент, Бектемирский район, Нурли йул МФЙ, улица Мехнатобод - 82',
    bin: '310072665', kpp: null, ogrn: null,
    directorTm: 'Direktor Mirzaýew Sardor', directorRu: 'Директор Мирзаев Сардор',
    bankNameTm: 'AKB "ASIA ALLIANCE BANK"', bankNameRu: 'АКБ "ASIA ALLIANCE BANK"',
    bankAddressTm: null, bankAddressRu: null, bik: null,
    acctKztRub: null, acctUsd: '20208000305594907001 UZS', acctRub: null,
  },
  {
    name: 'EXPORTLINK',
    nameTm: '« EXPORTLINK » JÇJ-ti', nameRu: 'OОО «EXPORTLINK»',
    addressTm: 'Uzbekistan, ş. Taşkent, etrap Almazarskiý, Ahil MFI, köçe Şifokor, jaý 108 A',
    addressRu: 'УЗБЕКИСТАН, Г. ТАШКЕНТ, АЛМАЗАРСКИЙ РАЙОН, АХИЛ МФЙ, УЛИЦА ШИФОКОР, ДОМ 108 А',
    bin: '312622169', kpp: null, ogrn: null,
    directorTm: 'Direktor Abdurahmonow A.U', directorRu: 'Директор Абдурахмонов А.У',
    bankNameTm: 'Taşkent ş., «Dawr-Bank» Hat-Bank fillial Ýunisabad', bankNameRu: 'г. Тошкент, «Давр-Банк» Хат Банк Юнусабадский филиал',
    bankAddressTm: null, bankAddressRu: null, bik: null,
    acctKztRub: null, acctUsd: '20208000907358252001 UZS', acctRub: null,
  },
  {
    name: 'FRESHWORLD TRADE',
    nameTm: '« FRESHWORLD TRADE » JÇJ-ti', nameRu: 'OОО «FRESHWORLD TRADE»',
    addressTm: 'Uzbekistan Respublikasy, Fergan oblasty, etrap Buwaýda, Kungirant MSG, köç. Adolat, j. №194-а',
    addressRu: 'Республика Узбекистан, Ферганская область, район Бувайда, Кунгират MСГ, улица Адолат, дом №194-a',
    bin: '312398186', kpp: null, ogrn: null,
    directorTm: 'Direktor Temirow L.R', directorRu: 'Директор Темиров Л.Р',
    bankNameTm: 'AKB «КАПИТАЛБАНК» Çorsu filialy', bankNameRu: 'АКБ «КАПИТАЛБАНК» ЧОРСУ ФИЛИАЛ',
    bankAddressTm: null, bankAddressRu: null, bik: 'KACHUZ22 XXX',
    acctKztRub: null, acctUsd: '20208840607302799001', acctRub: '20208643707302799001',
  },
  {
    name: 'AKTIV-EXPORT',
    nameTm: '« AKTIV-EXPORT » JÇJ-ti', nameRu: 'OОО «AKTIV-EXPORT»',
    addressTm: 'Özbegistan Respublikasy, Andijan sebiti, 171600, Şahrihan etraby, MSG Mullaboy, Nodira köçesi, bina-85a',
    addressRu: 'Республика Узбекистан, Андижанская область, 171600, Шахриханский р-н, МСГ Муллабой, улица Нодира, дом-85а',
    bin: '312 391 971', kpp: null, ogrn: null,
    directorTm: 'Direktor Mamatow H.R', directorRu: 'Директор Маматов Х.Р',
    bankNameTm: 'Özbegistanyň Milli Banky Andijan Şahamçasy', bankNameRu: 'Национальный банк Узбекистана Андижанский филиал',
    bankAddressTm: 'Özbegistanyň Milli Banky Andijan Şahamçasy, A.Nawoý şaýoly, 39, Andijan, Özbegistan', bankAddressRu: 'Национальный банк Узбекистана Андижанский филиал, проспект А.Навои, 39, г. Андижан, Узбекистан',
    bik: 'NBFA UZ 2X', acctKztRub: null, acctUsd: '20 208 840 807 301 151 001', acctRub: null,
  },
];

export const ALYJY_FIELD_DEFS: ReadonlyArray<{ readonly label: string; readonly key: keyof AlyjyFirm }> = [
  { label: 'Resmi ady (TM)', key: 'nameTm' },
  { label: 'Resmi ady (RU)', key: 'nameRu' },
  { label: 'Hukuk salgysy (TM)', key: 'addressTm' },
  { label: 'Hukuk salgysy (RU)', key: 'addressRu' },
  { label: 'BIN/INN', key: 'bin' },
  { label: 'KPP', key: 'kpp' },
  { label: 'OGRN', key: 'ogrn' },
  { label: 'Direktor (TM)', key: 'directorTm' },
  { label: 'Direktor (RU)', key: 'directorRu' },
  { label: 'Bank ady (TM)', key: 'bankNameTm' },
  { label: 'Bank ady (RU)', key: 'bankNameRu' },
  { label: 'Bank salgysy (TM)', key: 'bankAddressTm' },
  { label: 'Bank salgysy (RU)', key: 'bankAddressRu' },
  { label: 'БИК / BIC', key: 'bik' },
  { label: 'Hasap (KZT/RUB)', key: 'acctKztRub' },
  { label: 'Hasap (USD)', key: 'acctUsd' },
  { label: 'Hasap (RUB) — aýry bolsa', key: 'acctRub' },
];
