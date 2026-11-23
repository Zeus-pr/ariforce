import * as SecureStore from 'expo-secure-store';

/** Bump when the text changes so the next open of that build asks again. */
export const LEGAL_VERSION = '2026-11-23';

const KEY = 'ariforce.legal-accepted';

export async function legalAccepted(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY)) === LEGAL_VERSION;
}

export function acceptLegal(): Promise<void> {
  return SecureStore.setItemAsync(KEY, LEGAL_VERSION);
}

export type LegalBlock = { heading: string; paragraphs: string[] };

const COMPANY = 'ARIGHNA PHARMA PVT. LTD.';
const ADDRESS =
  'PL-5-B, 11/1, Sector 1, New Panvel (West), Mumbai, Maharashtra – 410206, India';
const EMAIL = 'support@arighnapharma.com';

export const TERMS: LegalBlock[] = [
  {
    heading: 'Terms and conditions',
    paragraphs: [
      'Internal e-reporting and field-force management application.',
      `Operated by ${COMPANY}.`,
      'Effective date: 14 November 2026. Version 1.0.',
      'These Terms govern authorised access to and use of ARIFORCE by employees, field representatives, managers, administrators and other approved users.',
    ],
  },
  {
    heading: '1. Acceptance and scope',
    paragraphs: [
      `These Terms govern access to and use of ARIFORCE, including its mobile application, web portal, administrator console, integrations and related services (“Platform”). The Platform is owned, operated or made available by ${COMPANY} (“Company”, “we”, “us”). By signing in, accepting electronically or continuing to use the Platform after these Terms are presented, you (“User”) agree to them. If you do not agree, do not use the Platform and contact your reporting manager. These Terms apply to employees, field-force personnel, managers, administrators, consultants, contractors, distributors and other persons expressly authorised by the Company. Access is private and permission-based.`,
    ],
  },
  {
    heading: '2. Purpose and permitted use',
    paragraphs: [
      'ARIFORCE is intended for authorised Company business, which may include field activity reporting, attendance and visit records, tour plans, doctor, chemist and stockist details, sales and order reporting, primary or secondary sales visibility, expense workflows, task communication, dashboards and management reporting. Use it only for legitimate Company business, within your assigned role and permissions, and in accordance with Company policies and lawful instructions. Features may be changed from time to time.',
    ],
  },
  {
    heading: '3. User accounts and security',
    paragraphs: [
      `Your account is personal. Keep passwords, OTPs, PINs, authentication tokens and devices secure; use a strong screen lock; and never share credentials or allow another person to submit reports under your identity. Promptly report suspected unauthorised access, device loss or theft, credential compromise or security incidents to ${EMAIL} and your reporting manager. The Company may reset credentials, require additional authentication, restrict sessions or suspend access. Do not access another user’s account, data, territory or administrative functions without permission.`,
    ],
  },
  {
    heading: '4. Accuracy and user responsibilities',
    paragraphs: [
      'You are responsible for ensuring that information submitted is accurate, complete, current and submitted within Company timelines. This may include visit details, attendance, location-linked records, orders, sales figures, expenses, customer details, remarks, photographs and supporting documents. Do not create fictitious visits, backdate or manipulate records, submit duplicate or misleading entries, falsify GPS or location information, alter device time to mislead the system, or submit information for another person without written authorisation. Correct errors through the approved workflow or notify your manager. Audit logs and correction history may be retained.',
    ],
  },
  {
    heading: '5. Confidentiality and business information',
    paragraphs: [
      'ARIFORCE may contain confidential or commercially sensitive information, including doctor, hospital, chemist, stockist, distributor and CFA details; territory plans; pricing; sales, stock and order information; product and launch information; business strategies; and internal communications (“Company Information”). Use it only for authorised Company purposes. Do not disclose, copy, export, photograph, publish, sell, transfer or use it for personal or competing business purposes unless authorised or required by law. Do not upload unlawful, defamatory, infringing or unrelated material. Do not enter patient-identifiable health information or medical records unless expressly authorised with appropriate safeguards.',
    ],
  },
  {
    heading: '6. Location, device permissions and monitoring',
    paragraphs: [
      'Some features may request location, camera, photos or files, notifications or other device permissions. Enable permissions only where required for an identified business feature. If location services are enabled, location information may be collected at relevant times for attendance, visit verification, route or field-activity reporting, security and operational review, subject to configured settings and applicable law. Technical information may include device model, operating system, app version, login and session details, IP and network information, timestamps, diagnostics and audit logs. Monitoring must be proportionate and follow Company notices and applicable law. These Terms do not imply continuous tracking unless that feature is enabled and disclosed.',
    ],
  },
  {
    heading: '7. Integrations and synchronisation',
    paragraphs: [
      'The Platform may connect to Company-approved ERP, CFA, distributor or reporting systems, messaging, hosting, analytics, maps, notification or authentication services. Integrated data is subject to source-system availability, configuration and data quality. Information may be delayed or inconsistent due to network interruptions, third-party outages, synchronisation queues, incorrect source records or maintenance. Do not assume a submission has been received until the Platform shows confirmation. Report integration errors promptly and do not bypass system controls.',
    ],
  },
  {
    heading: '8. Acceptable use',
    paragraphs: [
      'Do not reverse engineer, decompile, copy or tamper with the Platform except where prohibited by law; introduce malware; probe or test security without written approval; interfere with service availability; scrape or bulk-extract data; bypass access controls; use the Platform unlawfully or fraudulently; or infringe intellectual-property, privacy or other legal rights. Use only approved app versions and distribution channels. Do not install modified or unofficial versions or compromise a Company-managed device in a way that undermines security controls.',
    ],
  },
  {
    heading: '9. Intellectual property and licence',
    paragraphs: [
      'The Platform, including its software, design, text, graphics, logos, workflows, databases, reports and related intellectual property, is owned by or licensed to the Company or its licensors. No ownership rights are transferred to you. While authorised, you receive a limited, revocable, non-exclusive, non-transferable and non-sublicensable right to use the Platform solely for authorised Company business. All rights not expressly granted are reserved.',
    ],
  },
  {
    heading: '10. Availability and changes',
    paragraphs: [
      'The Company may update, suspend, restrict or discontinue all or part of the Platform for maintenance, security, operational, legal or business reasons. It will endeavour to communicate material planned interruptions where practicable. The Platform may not be uninterrupted, error-free or available on every device or network. Follow approved backup, reporting and escalation procedures when it is unavailable.',
    ],
  },
  {
    heading: '11. Suspension and termination',
    paragraphs: [
      'The Company may suspend, limit or terminate access if your role or authorisation ends, these Terms or Company policies are breached, credentials or data may be compromised, an investigation is required, or continued access may create legal, security or business risk. On termination, stop using the Platform and return or secure Company devices, records and information as instructed. Provisions which by nature should continue, including confidentiality and data protection, will survive.',
    ],
  },
  {
    heading: '12. Privacy and personal data',
    paragraphs: [
      'The Company may process user and business-contact personal data to operate ARIFORCE, manage field activities, administer employment or authorised business relationships, maintain security, comply with law and resolve disputes. Personal data is handled under the AriForce Privacy Notice, Company policies and applicable Indian data-protection and information-technology laws. These Terms are not a substitute for that Privacy Notice.',
    ],
  },
  {
    heading: '13. Records, retention and audit',
    paragraphs: [
      'Platform records may be retained for operational, employment, audit, regulatory, tax, legal, security and dispute-resolution purposes under the Company’s retention schedule and applicable law. Retention periods may differ by record type. Authorised Company personnel may review records and audit trails for legitimate business, compliance, security, performance-management or investigation purposes, subject to applicable law and internal access controls.',
    ],
  },
  {
    heading: '14. Disclaimers and limitation of liability',
    paragraphs: [
      'To the maximum extent permitted by law, the Platform is provided on an “as available” basis. The Company does not warrant that every feature will be uninterrupted, error-free or compatible with every device or network. Users remain responsible for reviewing important entries and following escalation procedures. Nothing excludes or limits liability where prohibited by law. Subject to that restriction, the Company will not be liable for indirect, incidental, special or consequential loss arising from use or inability to use the Platform, including loss caused by network failure, third-party outage, inaccurate source data or unauthorised acts outside the Company’s reasonable control. These Terms do not modify statutory employment rights, employment contracts or separate written agreements.',
    ],
  },
  {
    heading: '15. Indemnity',
    paragraphs: [
      'To the extent permitted by law, a user may be responsible for losses, claims or reasonable costs directly arising from wilful misconduct, fraud, unlawful use, deliberate security breach, infringement of third-party rights or material violation of these Terms. This does not create liability for ordinary good-faith mistakes or limit rights that cannot lawfully be limited.',
    ],
  },
  {
    heading: '16. Changes to these Terms',
    paragraphs: [
      'The Company may revise these Terms to reflect changes in the Platform, operations, security requirements or applicable law. The latest version and effective date are made available in the Platform. Where required, renewed acceptance will be sought.',
    ],
  },
  {
    heading: '17. Governing law and jurisdiction',
    paragraphs: [
      'These Terms are governed by the laws of India. Subject to mandatory legal requirements and any applicable dispute-resolution agreement, courts of competent jurisdiction at Mumbai, Maharashtra, India shall have jurisdiction over disputes arising from these Terms.',
    ],
  },
  {
    heading: '18. General',
    paragraphs: [
      'If any provision is invalid or unenforceable, the remaining provisions continue to apply to the extent possible. Failure or delay in enforcing a provision is not a waiver. You may not transfer your access rights. The Company may assign its rights and obligations as part of a lawful business reorganisation or transfer. These Terms, together with the Privacy Notice and relevant Company policies, govern use of ARIFORCE. A specific written agreement or mandatory law prevails to the extent of any conflict.',
    ],
  },
  {
    heading: '19. Contact',
    paragraphs: [
      COMPANY,
      'ARIFORCE support',
      `Email: ${EMAIL}`,
      `Address: ${ADDRESS}`,
      'For questions, access issues, security incidents, data-related requests or grievances concerning ARIFORCE, contact the email above. Do not include sensitive personal information in an ordinary support email unless requested through a secure channel.',
    ],
  },
];

export const PRIVACY: LegalBlock[] = [
  {
    heading: 'Privacy notice',
    paragraphs: [
      `${COMPANY} (“Company”, “we”) operates AriForce for authorised employees and other approved users.`,
      'Effective date: 16 November 2026. Version 1.0.',
      'This notice explains what personal data AriForce collects, why, who can see it, and how to raise a request.',
    ],
  },
  {
    heading: '1. Who this notice applies to',
    paragraphs: [
      'It applies to people the Company authorises to use AriForce, and to the business-contact details those users record while doing Company work, such as a doctor, chemist or stockist name and professional details.',
      'AriForce is not a patient-care system. Do not enter a patient’s medical record or other information that identifies a patient.',
    ],
  },
  {
    heading: '2. Information we collect',
    paragraphs: [
      'Account. Name, work email, employee code, designation, role, reporting line, territory and company.',
      'Sign-in. One-time codes, the session kept on the device, and the time of sign-in.',
      'Work you submit. Daily call reports, tour plans, attendance, leave, expenses, receipt images, remarks, and the products, samples and orders on a call.',
      'Location, when you use a feature that needs it. Coordinates, accuracy, time, and distance from a saved outlet pin. A reading is taken when you punch in, punch out, check in at an outlet, or open a presentation. AriForce does not keep a continuous background trail of where you go.',
      'Device. Model, operating system, app version, an identifier used to enrol the phone, a notification token if you allow notifications, and a flag if the location reading is reported as a mock location.',
      'Technical records. Timestamps, the history of saves and approvals, and the network information our servers receive with a request.',
    ],
  },
  {
    heading: '3. Why we use it',
    paragraphs: [
      'To run AriForce, confirm field activity and attendance, process tour plans, leave and expenses, show work to the managers responsible for you, keep accounts secure, investigate misuse, answer support requests, and meet legal, tax and audit duties.',
      'We do not sell personal data. We do not use it for advertising.',
    ],
  },
  {
    heading: '4. Who can see it',
    paragraphs: [
      'People in your reporting line, and administrators, can see the screens their role allows. A person outside that line does not get your reports.',
      'Companies that host the application and its database, and the service that delivers notifications to your phone, process data only so AriForce can run.',
      'If you tap a map pin, your phone opens that pin in the maps app on the device. That app is a separate service.',
    ],
  },
  {
    heading: '5. How long we keep it',
    paragraphs: [
      'We keep records while your authorisation lasts, and afterwards for the period needed for operations, employment, audit, tax, security and legal claims. Periods differ by record. When a record is no longer needed, we delete it or restrict access to it.',
    ],
  },
  {
    heading: '6. Security',
    paragraphs: [
      'Access follows role. The session stays on the device. An enrolled device is checked at sign-in. Report a lost phone, or a suspected compromise, to your reporting manager and to the address below.',
    ],
  },
  {
    heading: '7. Your requests',
    paragraphs: [
      `You may ask what we hold about you, ask for a correction, or raise a grievance about AriForce data. Email ${EMAIL}. Do not put sensitive personal information in an ordinary email unless we ask for it on a secure channel.`,
      'Where the Digital Personal Data Protection Act, 2023 gives you a right, we handle the request as that law requires. Records the law or your work with the Company requires us to keep are not deleted on request.',
    ],
  },
  {
    heading: '8. Changes',
    paragraphs: [
      'If this notice changes in a way that needs a fresh reading, AriForce asks you to read it and agree again before you continue.',
    ],
  },
  {
    heading: '9. Contact',
    paragraphs: [
      COMPANY,
      'AriForce support',
      `Email: ${EMAIL}`,
      `Address: ${ADDRESS}`,
    ],
  },
];
