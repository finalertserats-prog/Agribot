# Agri-Dosth — Farmer Onboarding Messages

Ready-to-send, WhatsApp-friendly messages for bringing farmers onto Agri-Dosth.
Bilingual (Hindi + English); swap in a regional language per your farmers.
Keep the **STOP / DELETE** lines — they're the consent/privacy controls.

> Replace `<NUMBER>` with the live Agri-Dosth WhatsApp number when you launch.
> For the pilot: send to a **few known, consenting farmers first**, not a broad blast.

---

## 1. Invitation (forward to a farmer, 1:1)

> 🌱 *नमस्ते! आपके लिए एक नया खेती-दोस्त — **Agri-Dosth**।*
> *यह WhatsApp पर आपके खेती के सवालों का जवाब देता है और फसल/पौधों की फोटो देखकर बीमारी पहचानता है — बिल्कुल मुफ़्त।*
>
> 👉 बस इस नंबर पर "Hello" भेजें: **<NUMBER>**
> *अपनी भाषा में पूछें (हिंदी/अंग्रेज़ी)। कभी भी **STOP** लिखें बंद करने के लिए।*
>
> ---
> 🌱 *Namaste! Meet **Agri-Dosth** — your new farming friend on WhatsApp.*
> *Ask any farming question or send a photo of a sick crop, and it helps you diagnose and fix it — free.*
>
> 👉 Just say "Hello" to **<NUMBER>** to start. Ask in your own language. Reply **STOP** anytime to stop.

---

## 2. Group announcement / pin (for a village or co-op group)

> 🌱 *दोस्तों, अब हमारे साथ **Agri-Dosth** है — एक खेती सहायक जो आपके सवालों का जवाब देता है।*
> *ग्रुप में पूछने के लिए **"agridosth"** लिखें, जैसे:*
> *"agridosth मेरे टमाटर के पत्ते पीले क्यों हो रहे हैं?"*
> *या सीधे मैसेज करें: **<NUMBER>**.*
>
> ---
> 🌱 *Friends, we now have **Agri-Dosth** in this group — a farming helper.*
> *To ask in the group, start your message with **"agridosth"**, e.g.:*
> *"agridosth why are my tomato leaves turning yellow?"*
> *Or message it directly: **<NUMBER>**. Reply STOP to opt out.*

---

## 3. What the bot says on first contact (auto-sent — for reference)

The bot **automatically** sends this the first time a farmer messages, *before* it answers —
so consent is captured up front. (This lives in `config.consentMessage`; no action needed.)

> 🌱 नमस्ते! मैं **Agri-Dosth** हूँ — किसानों का AI दोस्त। मैं खेती, फसल और पौधों की समस्याओं में
> आपकी मदद करता हूँ। आप फसल की फोटो भी भेज सकते हैं। आपके संदेश/फोटो एक AI सेवा को भेजे और
> सुरक्षित रखे जाते हैं ताकि मैं बेहतर मदद कर सकूँ। कभी भी **STOP** लिखें बंद करने के लिए, या
> **DELETE** लिखें अपना डेटा मिटाने के लिए।
>
> 🌱 Namaste! I'm **Agri-Dosth**, your AI farming friend… Reply **STOP** to unsubscribe, or **DELETE** to erase your data.

Then, as a friend would, Agri-Dosth will ask the farmer's **name and where they farm**, and
use their name in the conversation.

---

## 4. Short SMS / flyer / poster line

> 🌱 Agri-Dosth — your free farming helper on WhatsApp.
> Ask crop questions or send a plant photo. Message **<NUMBER>** and say Hello.
> हिंदी में पूछें। Reply STOP to opt out.

---

## 5. Rollout tips for the operator
- **Start small:** a handful of known, consenting farmers or one trusted group — prove it works,
  watch quality, then widen. (Protects the number and your OpenAI cost.)
- **Ask permission first** before adding anyone or sharing the number — don't cold-blast.
- **Set expectations:** it's an AI helper, not a replacement for a local agri-officer; for exact
  pesticide doses it will (correctly) point them to the product label / KVK.
- **Encourage photos** — plant-disease diagnosis is the "wow" feature.
- **Watch the first day of chats** to confirm replies are accurate and on-topic before scaling.
