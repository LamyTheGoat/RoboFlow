# RoboFlow Kullanım Kılavuzu

*Bu kılavuz, konuyla ilgili hiçbir ön bilgisi olmayan biri için yazılmıştır.
Teknik terimler ilk geçtiği yerde açıklanır.*

---

## 1. RoboFlow nedir?

RoboFlow, robotlarla çalışan bir fabrikanın **kontrol odasıdır**. Tarayıcınızda
açılır ve size tek ekranda şunları gösterir:

- Fabrikadaki her makinenin (istasyonun) o anda ne yaptığını,
- Müşteri siparişlerinin nerede olduğunu ve ne durumda olduğunu,
- Depoda ne kadar malzeme kaldığını,
- Bir sorun çıktığında (arıza, malzeme eksiği, aşırı ısınma) uyarıları.

Ayrıca RoboFlow bir **tasarım aracıdır**: kendi istasyon tiplerinizi
tasarlayabilir, üretim adımlarını (iş akışlarını) oluşturabilir ve fabrikanızın
yerleşim planını kuşbakışı bir haritada — bir kurma oyunu gibi — kendiniz
çizebilirsiniz.

> **Simülatör nedir?** Gerçek robotlar bağlı değilken RoboFlow, fabrikayı
> kendi kendine "oynatan" bir simülatörle çalışır. Ekranın üstünde
> "Simulator feed" rozeti görüyorsanız veriler simülatörden geliyor demektir.
> Gerçek makineler bağlandığında simülatör kapatılır; ekranlar aynı kalır.

---

## 2. Temel kavramlar (küçük sözlük)

| Kavram | Anlamı |
|---|---|
| **İstasyon (Station)** | Fabrikada bir işi yapan makine/hücre. Örnek: kesim istasyonu, kaynak istasyonu, paketleme hattı. |
| **Robot** | Bir istasyonun içinde çalışan robot kol. Sıcaklığı ve aşınması izlenir. |
| **İstasyon tipi (Station type)** | Bir istasyonun "tarifi": adı, simgesi, bir ürünü kaç saniyede işlediği, hangi malzemeleri tükettiği, kapladığı alan. Tiplerden istediğiniz kadar gerçek istasyon kurabilirsiniz. |
| **İş akışı (Workflow)** | Bir ürünün üretilmesi için sırayla geçmesi gereken adımlar listesi. Örnek: Kes → Kaynakla → Monta et → Kontrol et → Paketle. |
| **Sipariş (Order)** | Bir müşterinin istediği iş. Örnek: "Nordwerk için 12 adet robot kol tabanı". Sipariş, iş akışındaki adımları sırayla dolaşır. |
| **Proje / Ürün hattı (Project)** | Ürettiğiniz bir ürün ailesi. Her proje bir iş akışına bağlıdır; o ürüne gelen siparişler o akışı izler. |
| **Depo (Warehouse)** | Ham madde ve parça stoğu. Üretim başlarken malzemeler otomatik düşülür. |
| **Uyarı (Alert)** | Dikkat etmeniz gereken olay: arıza, düşük stok, aşırı ısınma, yavaşlama vb. |

---

## 3. Programı açmak

Bilgisayarınızda kurulum yapan kişiden adresi isteyin (genellikle
`http://localhost:4000` ya da şirket içi bir adres) ve tarayıcıda açın.
Kurulumu kendiniz yapacaksanız:

```bash
npm install        # bir kez, gerekli paketleri indirir
npm run build      # arayüzü derler
npm start          # sunucuyu başlatır → http://localhost:4000
```

Sağ üstte yeşil **"Live"** yazısını görüyorsanız bağlantı canlıdır; ekran
saniyede bir kendini günceller, hiçbir şeye basmanıza gerek yoktur.

### 3.1 Giriş ve roller

Program açıldığında bir **giriş ekranı** karşılar. İki tür kullanıcı vardır:

| Rol | Ne yapabilir? |
|---|---|
| **manager** (yönetici) | Her şey: istasyon/iş akışı tasarlamak, zemini düzenlemek, üretimi yönetmek. |
| **operator** (operatör) | Üretimi yönetmek: istasyon komutları, acil durdurma, sipariş girmek, uyarı onaylamak. Tasarım sayfaları ona **salt okunur**dur ("view only" yazar). |

İlk kurulumda iki hazır kullanıcı gelir: `manager / manager123` ve
`operator / operator123`. **Bu şifreleri ilk fırsatta değiştirin** (kurulumu
yapan kişi `POST /api/auth/password` ile değiştirebilir). Sağ üstteki adınıza
bitişik **Sign out** düğmesi oturumu kapatır.

---

## 4. Ekranın genel yapısı

- **Sol menü:** sayfalar arasında geçiş. Yanlardaki küçük sayılar özet bilgidir
  (örn. Alerts yanındaki kırmızı sayı = açık uyarı sayısı).
- **Üst bar:** fabrika adı, "Simulator feed" rozeti (varsa), canlı bağlantı
  durumu ve saat.
- **Sol alttaki kırmızı EMERGENCY STOP:** acil durdurma. Basıp onayladığınızda
  **bütün istasyonlar durur** ve kritik bir uyarı düşer. Sadece gerçek acil
  durumda kullanın; sonrasında istasyonları tek tek "Start" ile yeniden
  başlatmanız gerekir.

---

## 5. Sayfalar tek tek

### 5.1 Overview (Genel Bakış) — güne buradan başlayın

Fabrikanın özeti:

- **Üstteki 4 kutu:** kaç istasyon çalışıyor, kaç açık sipariş var, bugün kaç
  ürün bitti, kaç açık uyarı var.
- **Throughput grafiği:** son bir saatte dakika başına biten ürün sayısı.
  Fare ile üzerine gelince tam değeri gösterir.
- **Station utilization:** her istasyonun ne kadar dolu çalıştığı (%).
- **Attention needed:** ilgilenmeniz gereken şeyler — açık uyarılar ve azalan
  stoklar. Boşsa her şey yolundadır.
- **Live event feed:** fabrikada olan biten her şeyin canlı akışı
  ("ORD-1005 kaynağı bitirdi", "depoya teslimat geldi" gibi).

### 5.2 Factory (Fabrika) — kuşbakışı yerleşim planı

Fabrikanızın haritası. Soldaki **📥 WAREHOUSE** şeridi deponun, sağdaki
**🚚 DISPATCH** şeridi sevkiyatın simgesidir; ürünler soldan girer, sağdan çıkar.

- **Kutular = istasyonlar.** Boyutları gerçek yer kaplamalarını gösterir
  (2×2'lik bir montaj hattı, 1×1'lik kaynak hücresinden büyük görünür).
  Renkler durumu anlatır: yeşil çerçeve = çalışıyor, sarı = duraklatıldı,
  yanıp sönen kırmızı = arıza, kesikli çerçeve = durdurulmuş.
- **İstasyon kurmak:** üstteki paletten bir tip seçin (örn. "🔥 Welder 1×1"),
  haritada boş bir yere gelin. Fare ile gezerken **yeşil hayalet** görürsünüz =
  oraya sığar; **kırmızı hayalet** = sığmaz (taşma ya da çakışma). Yeşilken
  tıklayın — istasyon anında kurulur ve fabrika ona iş vermeye başlar.
- **İstasyon seçmek:** "Select" modunda bir kutuya tıklayın. Alt panelde adını
  değiştirebilir, **✥ Move** ile başka yere taşıyabilir, **Dismantle** ile
  sökebilirsiniz (o an iş yapan istasyon sökülmez).
- **Rota göstermek:** sağ üstteki "show route" listesinden bir iş akışı seçin.
  Deponun kapısından sevkiyata kadar hareketli bir hat çizilir. Eksik bir adım
  varsa ("bu işi yapabilecek istasyon yok") sarı bir uyarı şeridi çıkar.
- **Sipariş pulları:** üzerinde #1005 gibi numaralar yazan küçük yuvarlaklar
  siparişlerdir; hangi istasyonda çalışıldığını gösterir ve iş ilerledikçe
  hareket eder. Bekleyenler depo şeridinde sıralanır, yeni bitenler sevkiyat
  şeridinde görünür.
- **Zemini büyütmek/küçültmek:** sağ üstteki **⛶ Floor 28×16** düğmesine
  basın, yeni genişlik×derinlik girin, Apply deyin. Üzerinde istasyon kalan
  bir alanı kesmeye çalışırsanız sistem sizi uyarır ve izin vermez.

### 5.3 Stations (İstasyonlar) — makine kartları ve komutlar

Her istasyonun ayrıntı kartı:

- Hangi siparişte çalıştığı ve o partinin yüzde kaçının bittiği,
- İçindeki robotların durumu (sıcaklık, takım aşınması),
- **⏱ Hız satırı:** "planned 3s → measured 4.4s/unit" gibi. *Planned* sizin
  tasarımda verdiğiniz süre, *measured* makinenin gerçekte ölçülen hızıdır.
  Yanında **⚠ slow** görüyorsanız makine tasarlanandan belirgin şekilde yavaş
  çalışıyor demektir (bkz. bölüm 6).
- **Komut düğmeleri:**
  - **▶ Start** — duraklatılmış/durdurulmuş istasyonu çalıştırır.
  - **⏸ Pause** — işi duraklatır (kaldığı yerden devam eder).
  - **■ Stop** — istasyonu durdurur.
  - **Reset fault** — arıza giderildiyse istasyonu tekrar kullanılabilir yapar
    (yalnızca arızalı istasyonda görünür).

### 5.4 Orders (Siparişler)

Bütün siparişlerin listesi. Her satırda:

- **Workflow sütunu:** adım noktaları. Mavi dolu = bitti, yeşil yanıp sönen =
  şu an yapılıyor, gri = sırada.
- **Location:** siparişin fiziksel yeri ("Welding Cell A", "Warehouse —
  staged", "Buffer before Inspector", "Dispatch — shipped").
- **Priority:** açılır listeden önceliği değiştirebilirsiniz; High öncelikli
  siparişler istasyonlara önce girer.
- **Due:** teslim tarihi; geçtiyse kırmızı ⚠ ile gösterilir.
- **+ New order:** ürün hattını seçin, müşteri adı ve adet girin — sipariş
  kuyruğa girer ve uygun istasyon boşaldığı anda üretim başlar.

### 5.5 Design studio (Tasarım Stüdyosu) — işin mutfağı

İki sekme vardır:

**Station types (İstasyon tipleri):** makinelerinizin tariflerini burada
yaparsınız.

- Ad, simge (hazır emojilerden seçebilirsiniz) ve açıklama verin.
- **Footprint:** makinenin zeminde kaç hücre kaplayacağı (genişlik × derinlik,
  en çok 4×4). Yandaki küçük önizleme şekli gösterir. Not: yerleşik
  istasyonlar kurulduklarındaki boyutu korur; yeni boyut yeni kurulumlara
  uygulanır.
- **Time per unit:** bir ürünü kaç saniyede işlediği (planlanan süre).
- **Inputs:** ürün başına depodan düşülecek malzemeler.
- **Outputs:** ürettiği şey (bilgi amaçlı).
- **⏱ measured / adopt measured time:** makine sahada çalıştıkça gerçek hızı
  ölçülür ve burada görünür. **"adopt measured time"** düğmesi tek tıkla
  tasarım süresini ölçülen gerçek süreyle değiştirir — planlarınız gerçeğe
  uyum sağlar.
- **Composite (bileşik) istasyon:** birden çok iç istasyonu tek gövdede
  toplayan istasyon. Örnek: "Finishing Cell" hem boyar, hem kontrol eder, hem
  paketler. Bileşik istasyonlar başka bileşikleri de içerebilir; sistem bir
  istasyonun dolaylı olarak bile kendisini içermesine izin vermez.

**Workflows (İş akışları):** üretim adımlarının sırası.

- Soldan bir akış seçin ya da "+ New workflow" deyin.
- "Add a step" listesinden adım ekleyin: bir **istasyon tipi** ya da —
  işte asıl güç burada — **başka bir iş akışının tamamı**. Örneğin
  "Finishing & Dispatch" (boya → kontrol → paket) akışını birçok ürünün
  sonuna tek adım olarak koyabilirsiniz. İç içe akışlar serbesttir; sistem
  döngüye (bir akışın kendisini içermesine) izin vermez.
- Adımları **▲▼** ile sıralayın, **✕** ile silin.
- Her adımda "customize" ile o adımın tükettiği malzemeleri ürüne özel
  değiştirebilirsiniz.
- **Preview** şeridi, bir siparişin gerçekte yürüyeceği düz adım listesini ve
  ürün başına tahmini süreyi (tasarlanan + varsa sahada ölçülen) gösterir.
- Kaydedilen değişiklik **yeni** siparişlere uygulanır; hâlihazırda üretimde
  olan siparişler başladıkları rotayı bitirir. Bu bilinçli bir güvenlik
  kuralıdır.

### 5.6 Projects (Projeler / Ürün hatları)

Her ürün ailesinin kartı: hangi iş akışını kullandığı (açılır listeden
değiştirilebilir — yalnızca yeni siparişleri etkiler), sipariş sayıları ve
ürün başına malzeme listesi. **+ New product line** ile yeni ürün tanımlayıp
bir akışa bağlarsınız.

### 5.7 Warehouse (Depo)

Bütün malzemelerin stok listesi. Çubuk, doluluk oranını; çubuktaki küçük çizgi
**yeniden sipariş noktasını** gösterir. Stok bu çizginin altına inince sarı
"Low" uyarısı düşer. Sağdaki akışta depo hareketleri (üretim için malzeme
çekilmesi, gelen teslimatlar) listelenir.

### 5.8 Alerts (Uyarılar)

Bütün uyarıların listesi; önem derecesine göre süzebilirsiniz
(Critical > Serious > Warning > Info). Bir uyarıyı okuyup gereğini yaptıktan
sonra **Acknowledge** (onayla) düğmesine basın — uyarı "görüldü" olarak
işaretlenir ve sayaçlardan düşer. Uyarılar otomatik silinmez; onaylamak sizin
"haberim var" imzanızdır.

---

## 6. Planlanan hız ile gerçek hız — yavaşlama uyarısı

Siz bir istasyon tipine "ürün başına 30 saniye" dersiniz; ama gerçek makine
50 saniyede yapıyor olabilir. RoboFlow bunu kendiliğinden fark eder:

1. Her parti bittiğinde gerçek süre ölçülür ve istasyonun **measured**
   (ölçülen) hızı güncellenir.
2. En az 3 parti ölçüldükten sonra makine tasarlanandan **%30'dan fazla
   yavaşsa** sarı bir uyarı düşer: *"Running 40% slower than designed…"*.
   Bu çoğu zaman takım aşınmasının ya da besleme sorununun ilk işaretidir —
   bakım için erken davranma şansı verir.
3. Makine normale dönerse olay akışına "pace back within tolerance" notu düşer.
4. Ölçülen hızın doğru olduğuna karar verirseniz Design studio'da
   **"adopt measured time"** ile tasarımı tek tıkla gerçeğe eşitlersiniz;
   planlar ve önizlemeler artık doğru tahmin verir.

Önemli: planlanan süre makineyi **zorlamaz**. Üretim her zaman makinenin
gerçek "bitti" sinyaliyle ilerler; planlanan süre yalnızca tahmin ve
simülasyon içindir.

---

## 7. Sık yapılan işler (adım adım)

**Yeni bir ürünü sıfırdan üretime almak:**
1. *Design studio → Station types:* ürünün ihtiyaç duyduğu, elinizde olmayan
   istasyon tiplerini tasarlayın.
2. *Design studio → Workflows:* adımları sırayla dizin ("+ New workflow").
3. *Factory:* akıştaki her adımı yapabilecek en az bir istasyonu zemine kurun
   (eksik varsa rota görünümü sizi uyarır).
4. *Projects:* "+ New product line" ile ürünü tanımlayıp akışa bağlayın.
5. *Orders:* "+ New order" ile ilk siparişi girin. Gerisini fabrika halleder;
   Factory sayfasından pulun ilerleyişini izleyin.

**Bir istasyon arıza verdi:**
1. Alerts'te arıza uyarısını okuyun (nedeni yazar).
2. Sahada sorun giderildikten sonra *Stations* sayfasında **Reset fault**,
   ardından gerekiyorsa **Start**.
3. Uyarıyı **Acknowledge** ile kapatın.

**"Material shortage" uyarısı geldi (sipariş beklemede):**
Depoda o malzeme bitmiştir. Sipariş iptal olmaz; **on hold** durumunda bekler
ve teslimat gelip stok yetince kendiliğinden devam eder. Depo sayfasından
durumu izleyebilirsiniz.

---

## 8. Gerçek robotları bağlamak (teknik özet)

Bu bölüm kurulumu yapacak teknik kişi içindir. Bağlantı **iki yönlüdür**:

- **Makineden kontrol odasına:** gerçek makineler telemetrilerini
  `POST /api/ingest` adresine küçük JSON mesajları olarak gönderir (ilerleme
  yüzdesi, "parti bitti" sinyali, arıza, robot sıcaklığı) ya da bir MQTT
  broker'ı üzerinden `roboflow/telemetry` konusuna yayınlar.
- **Kontrol odasından makineye:** operatörün verdiği her komut
  (start/pause/stop/arıza sıfırlama/acil durdurma) bir **komut kuyruğuna**
  yazılır. Saha tarafı bunları iki yoldan alabilir: kuyruğu sorgulayıp
  onaylayarak (`GET /api/commands?status=pending` → uygula →
  `POST /api/commands/:id/ack`) ya da MQTT ile — sunucu her komutu anında
  `roboflow/commands/<istasyonId>` konusuna yayınlar.

MQTT için sunucu `MQTT_URL` ortam değişkeniyle başlatılır. Simülatör
`SIMULATOR=off` ile kapatılır; ekranlar ve işleyiş hiç değişmez. Makine
uçlarını yetkilendirmek için `INGEST_TOKEN` tanımlanabilir. Ayrıntılar ve
mesaj biçimleri için proje kökündeki `README.md` dosyasına bakın.

---

## 9. Sık sorulan sorular

**Ekranda "Reconnecting…" yazıyor.** Sunucuyla bağlantı koptu; sistem
kendiliğinden yeniden bağlanmayı dener. Sürerse kurulumu yapan kişiye haber verin.

**Yanlışlıkla acil durdurmaya bastım.** Panik yok: Stations sayfasında
istasyonları tek tek **Start** ile açın ve kritik uyarıyı onaylayın.

**İş akışını değiştirdim ama üretimdeki sipariş eski adımları izliyor.**
Bu tasarım gereğidir: değişiklikler yeni siparişlere uygulanır, eldeki iş
karışmaz.

**İstasyonu silemiyorum.** O an bir parti üzerinde çalışıyordur; önce **Stop**
ile durdurup partinin bitmesini bekleyin ya da işi bitince söküp kaldırın.

**Sipariş neden başlamıyor?** Üç olası neden: (1) adımı yapabilecek istasyon
zeminde yok — Factory'de uyarı şeridi çıkar; (2) malzeme eksik — sipariş
"on hold" olur; (3) bütün uygun istasyonlar dolu — sırada bekler.

İyi üretimler! 🏭
