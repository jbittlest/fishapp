# FishApp Terms of Use: DRAFT for attorney review

> **Status: draft, not in force.** Claude (an AI) wrote this on 2026-10-27 as a starting point for QuadSight
> Imaging LLC's attorney. It is not legal advice. Do not publish it, link it from the app, or upload it to App Store
> Connect until a California-licensed attorney has reviewed it. Items in `[BRACKETS]` are owner or attorney
> decisions. The notes in *italics* explain the drafting choices and should be removed before publication.
> See `docs/launch/legal-review.md` for the reasons behind this draft.

*Drafting notes:*
- *One document covers the iOS app (App Store), the web app (GitHub Pages) and the First Mate relay. Apple's standard
  Licensed Application EULA covers only the copy downloaded from the App Store. It says nothing about the web app,
  the AI assistant or the assumption of marine risk.*
- *Two ways to use this with Apple: (a) upload it as a custom EULA in App Store Connect (App Information > License
  Agreement). If you do, it must contain Apple's "minimum terms" (Section 17). (b) Keep Apple's standard EULA and link
  these Terms from the description and the app. Under (b), these Terms add to Apple's EULA for the iOS app and they
  are the only terms for the web app. Counsel should pick one.*
- *Enforceability depends on assent. The first-run "Before you head out" sheet (`src/shell/Onboarding.tsx`) should say
  "By tapping I agree, you accept the Terms of Use and acknowledge the Privacy Policy", link both, and bump its
  stored version so that existing users see it again.*

---

**FishApp Terms of Use**
Effective date: [DATE]

These Terms of Use ("Terms") are an agreement between you and **QuadSight Imaging LLC**, a California limited
liability company ("QuadSight", "we", "us"). They cover your use of the FishApp mobile application, the FishApp web
app at [https://jbittlest.github.io/fishapp/] and the FishApp AI assistant and relay (together, the "App").

**PLEASE READ SECTIONS 3, 4, 11 AND 12 CAREFULLY. THEY EXPLAIN THAT THE APP IS NOT A NAVIGATION INSTRUMENT, THAT YOU
ACCEPT THE RISKS OF BOATING AND FISHING, AND THAT OUR LIABILITY IS LIMITED. [IF ARBITRATION IS ADOPTED: SECTION 15
REQUIRES INDIVIDUAL ARBITRATION AND WAIVES CLASS ACTIONS.]**

## 1. Accepting these Terms
By installing, opening or using the App, or by tapping "I agree" (or similar), you agree to these Terms and confirm
that you have read the FishApp Privacy Policy at [https://jbittlest.github.io/fishapp/privacy.html]. If you do not
agree, do not use the App. You must be at least [13] years old to use the App. If you are under 18, a parent or
guardian must agree to these Terms for you.

## 2. The App and your licence
The App is offered free of charge. As long as you follow these Terms, we grant you a personal, non-exclusive,
non-transferable, revocable licence to use the App for your own non-commercial purposes. If you downloaded the App
from the Apple App Store, you may use it on Apple-branded devices that you own or control, as the App Store Usage Rules
permit. You may not sell, rent, sublicense or redistribute the App. You may not reverse engineer it except where the
law allows you to, or use it in a way that breaks the law or these Terms. We may change, suspend or discontinue any
feature at any time.

## 3. NOT FOR NAVIGATION: the App is an aid only
**The App is a navigation and fishing aid. It is not a certified navigation system, an ECDIS, a chart of record, a
depth sounder, a collision-avoidance or anchor-monitoring device, or a source of official weather or emergency
information.** In particular:

a. **Charts and depths.** Chart, bathymetry and depth data come from third parties such as NOAA, GEBCO and GMRT.
   That data may be incomplete, out of date, wrongly georeferenced or shown on a different vertical datum from your
   paper chart. Depths shown when you tap the chart are estimates from elevation models. They are not soundings, and
   they can be wrong by a large margin. Do not use them to judge clearance under your keel.
b. **Position.** GPS on a phone or tablet can be inaccurate, delayed or unavailable. Battery, heat, water, signal
   obstruction, operating-system restrictions or other apps can stop it.
c. **Anchor watch, Go-To and tracks.** These features depend on your device's GPS, battery, volume and notification
   settings, and on the operating system keeping the App running. Alarms can be late, false or missing. They are
   no substitute for a proper anchor watch kept by a person.
d. **Forecasts, tides, water temperature, radar and "go/no-go" readings** are computer-model estimates or
   predictions from third parties. They can be wrong or out of date, especially in a downloaded offline pack. Always
   get an official marine forecast (for example NOAA Weather Radio, VHF WX channels or weather.gov) before and during
   any trip.
e. You must carry and use the official charts, publications, safety equipment and radio required by law and by good
   seamanship. You must keep a proper lookout at all times, as the Navigation Rules require.

## 4. Assumption of risk
Boating, fishing, diving and being on or near the water carry serious risks, including property damage, injury,
drowning and death. **You use the App at your own risk, and you alone are responsible for the safety of your vessel,
your passengers and yourself, and for every decision you make on the water,** whether or not you used the App to make
it. [Counsel: consider a general maritime law choice and how it interacts with California's limits on releases;
see legal-review.md section 1.]

## 5. Fishing regulations and protected areas
The App shows general information about fishing regulations, size and bag limits, seasons, Marine Protected Areas
(MPAs) and closures. **This information is a convenience summary only. It may be wrong, incomplete or out of date, and
it is not legal advice.** MPA boundaries are drawn from public data and simplified for display, so they are
approximate. You are responsible for knowing and obeying the current regulations of the California Department of Fish
and Wildlife ([https://wildlife.ca.gov]), NOAA Fisheries, Mexican authorities and any other agency with jurisdiction.
That includes licences, report cards, limits, seasons, depth closures and MPA boundaries. A statement in the App,
including one by the AI assistant, does not excuse a violation.

## 6. The AI assistant ("First Mate")
a. The assistant gives automated answers. Some come from data on your device, and some, if you allow cloud AI, come
   from third-party AI models (currently Cloudflare Workers AI running Meta Llama, or Anthropic's Claude if you add
   your own API key). **AI answers can be wrong, incomplete or made up, and can sound confident when they are wrong.**
   Do not rely on them for navigation, weather, safety, medical, legal or regulatory decisions. In an emergency, use
   VHF Channel 16, call 911 or follow official guidance.
b. If you allow cloud AI, the information described in the Privacy Policy is sent to those providers to produce an
   answer. You can turn this off at any time in the assistant's settings.
c. If you use your own Anthropic API key, your use of Anthropic's services is governed by your own agreement with
   Anthropic. You are responsible for your key, its charges and its security.
d. You may not use the assistant to create unlawful, harmful or abusive content, to attack or overload the relay, or
   to get around its limits. The free relay has daily limits. We may change, rate-limit or withdraw it at any time.
e. When you ask the assistant to act in the App (for example, to save or delete a waypoint), check the result. We are
   not responsible for data the assistant changes at your request.

## 7. Emergency features
The SOS screen shows your device's position, pre-fills a text message, opens your phone dialer and shows radio
guidance. **The App does not contact the Coast Guard, 911 or anyone else for you.** Nothing is sent unless you send
it yourself. Calls and texts need a cellular or satellite service that may not be available. The App is not a
substitute for a VHF radio with DSC, an EPIRB, a PLB or other emergency equipment.

## 8. Third-party data, services and links
The App shows content from, and links to, third parties (for example NOAA, GEBCO, Esri, OpenStreetMap, OpenSeaMap,
Open-Meteo, iNaturalist, Cloudflare and Anthropic). We do not control them, and they may change or stop at any time.
Your use of their content may also be subject to their terms. Third-party content belongs to its owners and is used
under their licences. Credits are in About > Data sources & credits.

## 9. Your content and data
Spots, tracks, catches, photos and settings you create are stored on your device. You own them. We do not have a copy
and cannot recover them. Back them up with the App's export feature. When you share a spot link or a catch card, you
choose who gets it, and they may pass it on. You are responsible for anything you share. Do not share content that
infringes anyone's rights.

## 10. Our intellectual property
The App, its design, text, icons, diagrams and the FishApp and [First Mate] names and logos belong to QuadSight or
its licensors. Open-source components are licensed under their own licences, listed in [About > Open-source
licences]. Nothing in these Terms gives you any right in our trademarks.

## 11. DISCLAIMER OF WARRANTIES
TO THE FULLEST EXTENT ALLOWED BY LAW, THE APP AND ALL CONTENT, DATA AND AI OUTPUT ARE PROVIDED "AS IS" AND "AS
AVAILABLE", WITH ALL FAULTS AND WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. THIS INCLUDES ANY IMPLIED
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE (INCLUDING NAVIGATION), ACCURACY, QUIET ENJOYMENT AND
NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE APP WILL BE ACCURATE, CURRENT, UNINTERRUPTED, ERROR-FREE OR AVAILABLE
OFFLINE OR ON ANY PARTICULAR DEVICE, OR THAT ANY ALARM OR NOTIFICATION WILL WORK. Some jurisdictions do not allow these
exclusions, so some of them may not apply to you.

## 12. LIMITATION OF LIABILITY
TO THE FULLEST EXTENT ALLOWED BY LAW: (a) QUADSIGHT AND ITS MEMBERS, MANAGERS, EMPLOYEES AND CONTRACTORS WILL NOT BE
LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES, OR FOR LOSS OF DATA,
CATCH, EQUIPMENT, VESSEL OR PROFITS, ARISING OUT OF OR RELATING TO THE APP OR THESE TERMS, HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, EVEN IF WE WERE ADVISED OF THE POSSIBILITY; AND (b) OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO
THE APP WILL NOT EXCEED [FIFTY U.S. DOLLARS (US$50)]. Nothing in these Terms limits liability that cannot be limited
by law, such as liability for fraud, for wilful injury or, where applicable law so provides, for gross negligence
or personal injury. [Counsel: California Civil Code section 1668; Tunkl; City of Santa Barbara v. Superior Court
(2007).]

## 13. Indemnity
To the extent the law allows, you will defend, indemnify and hold harmless QuadSight and its members, managers,
employees and contractors from claims, losses and expenses (including reasonable attorneys' fees) brought by third
parties, including your passengers, that arise from your use of the App, your operation of a vessel, your breach of
these Terms or your violation of any law or anyone's rights. [Counsel: decide whether to keep this for a free
consumer app. It is often unenforceable or unwelcome against consumers.]

## 14. Changes and termination
We may update these Terms. When we do, we will change the effective date and, for material changes, tell you in the
App. If you keep using the App after a change, you accept the new Terms. You may stop using the App at any time by
deleting it. We may suspend or end your access to the App or the relay if you break these Terms. Sections 3 to 5 and
8 to 16 survive termination.

## 15. Governing law and disputes
These Terms are governed by the laws of the State of California and, where it applies, the general maritime law of
the United States, without regard to conflict-of-law rules. [OPTION A, courts: The state and federal courts in
[COUNTY] County, California, have exclusive jurisdiction, and you and we consent to them.] [OPTION B, arbitration:
an individual-arbitration clause with a class-action waiver, a small-claims carve-out and a 30-day opt-out. Counsel
to draft.] Nothing here limits any non-waivable rights you have as a consumer where you live.

## 16. General
These Terms, the Privacy Policy and any App Store terms that apply are the entire agreement between you and us about
the App. If any part is found unenforceable, the rest stays in effect. Our failure to enforce a term is not a waiver.
You may not assign these Terms. We may assign them to a successor. Contact: QuadSight Imaging LLC, [STREET ADDRESS],
California, [ZIP]; [support email].

## 17. Additional terms for the iOS app (Apple minimum terms)
*Required by Apple if these Terms are uploaded as a custom EULA (Apple's "Minimum Terms of Developer's End-User
License Agreement"). Counsel should check the wording against Apple's current list.*

a. **Parties.** These Terms are between you and QuadSight only, not Apple Inc. ("Apple"). QuadSight, not Apple, is
   solely responsible for the App and its content.
b. **Scope of licence.** Your licence to the iOS app is limited to use on Apple-branded products that you own or
   control, as permitted by the Usage Rules in the Apple Media Services Terms and Conditions. Family Sharing and
   volume-purchase use are allowed as those rules provide.
c. **Maintenance and support.** QuadSight, not Apple, is solely responsible for any maintenance and support. Apple has
   no obligation to provide any maintenance or support for the App.
d. **Warranty.** To the extent any warranty is not effectively disclaimed, QuadSight, not Apple, is responsible for it.
   If the App fails to conform to an applicable warranty, you may notify Apple, and Apple will refund the purchase
   price (if any). To the maximum extent permitted by law, Apple has no other warranty obligation with respect to the
   App.
e. **Product claims.** QuadSight, not Apple, is responsible for addressing any claims by you or a third party relating
   to the App or your possession or use of it. These include product liability claims, claims that the App fails to
   meet a legal or regulatory requirement, and claims under consumer protection, privacy or similar laws.
f. **Intellectual property.** If a third party claims that the App or your possession and use of it infringes their
   intellectual property rights, QuadSight, not Apple, is solely responsible for the investigation, defence,
   settlement and discharge of that claim.
g. **Legal compliance.** You represent that you are not located in a country subject to a U.S. Government embargo or
   designated as a "terrorist supporting" country, and that you are not on any U.S. Government list of prohibited or
   restricted parties.
h. **Developer contact.** Questions, complaints or claims: QuadSight Imaging LLC, [ADDRESS], [EMAIL], [PHONE].
i. **Third-party terms.** You must comply with any applicable third-party agreement when using the App (for example,
   your wireless data agreement, or Anthropic's terms if you use your own key).
j. **Third-party beneficiary.** Apple and its subsidiaries are third-party beneficiaries of these Terms. Once you
   accept them, Apple has the right, and is deemed to have accepted the right, to enforce these Terms against you as a
   third-party beneficiary.
