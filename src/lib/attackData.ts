// A curated (not exhaustive) subset of the MITRE ATT&CK Enterprise matrix —
// real technique IDs, names, and short descriptions across all 14
// tactics, kept local so browsing/searching/tagging needs no network
// call and no API key. This intentionally covers only top-level
// techniques (no sub-techniques) — enough to be genuinely useful for
// tagging findings and seeing a real tactic-coverage picture, without
// trying to be a live mirror of the full framework (attack.mitre.org
// has ~700+ entries once you include sub-techniques; that's a dataset
// worth fetching from MITRE's own STIX bundle, not hand-curating).

export type AttackTactic =
  | "Reconnaissance"
  | "Resource Development"
  | "Initial Access"
  | "Execution"
  | "Persistence"
  | "Privilege Escalation"
  | "Defense Evasion"
  | "Credential Access"
  | "Discovery"
  | "Lateral Movement"
  | "Collection"
  | "Command and Control"
  | "Exfiltration"
  | "Impact";

export const ATTACK_TACTICS: AttackTactic[] = [
  "Reconnaissance",
  "Resource Development",
  "Initial Access",
  "Execution",
  "Persistence",
  "Privilege Escalation",
  "Defense Evasion",
  "Credential Access",
  "Discovery",
  "Lateral Movement",
  "Collection",
  "Command and Control",
  "Exfiltration",
  "Impact",
];

export type AttackTechnique = {
  id: string;
  name: string;
  tactic: AttackTactic;
  description: string;
};

export const ATTACK_TECHNIQUES: AttackTechnique[] = [
  // Reconnaissance
  { id: "T1595", name: "Active Scanning", tactic: "Reconnaissance", description: "Probing victim infrastructure directly — port scans, vulnerability scans — to gather info before an attack." },
  { id: "T1592", name: "Gather Victim Host Information", tactic: "Reconnaissance", description: "Collecting details about victim hosts — hardware, software, configurations — usable for targeting." },
  { id: "T1589", name: "Gather Victim Identity Information", tactic: "Reconnaissance", description: "Harvesting names, emails, credentials of people at the target organization." },
  { id: "T1590", name: "Gather Victim Network Information", tactic: "Reconnaissance", description: "Mapping domains, IP ranges, network topology, and trust relationships." },
  { id: "T1591", name: "Gather Victim Org Information", tactic: "Reconnaissance", description: "Researching org structure, roles, physical locations, and business relationships." },
  { id: "T1598", name: "Phishing for Information", tactic: "Reconnaissance", description: "Sending phishing messages to elicit sensitive info rather than deliver malware directly." },
  { id: "T1593", name: "Search Open Websites/Domains", tactic: "Reconnaissance", description: "Using search engines, social media, and public code repos to gather info about a target." },
  { id: "T1594", name: "Search Victim-Owned Websites", tactic: "Reconnaissance", description: "Mining a target's own website for names, tech stack, and organizational detail." },

  // Resource Development
  { id: "T1583", name: "Acquire Infrastructure", tactic: "Resource Development", description: "Buying/leasing servers, domains, and cloud services to use in an attack." },
  { id: "T1586", name: "Compromise Accounts", tactic: "Resource Development", description: "Taking over existing accounts (email, social media) to use in operations." },
  { id: "T1584", name: "Compromise Infrastructure", tactic: "Resource Development", description: "Taking over third-party servers/domains/services rather than buying new ones." },
  { id: "T1587", name: "Develop Capabilities", tactic: "Resource Development", description: "Building custom malware, exploits, or tooling in-house." },
  { id: "T1585", name: "Establish Accounts", tactic: "Resource Development", description: "Creating fake personas/accounts to support social engineering or C2." },
  { id: "T1588", name: "Obtain Capabilities", tactic: "Resource Development", description: "Buying or downloading existing malware, exploits, and tools instead of building them." },
  { id: "T1608", name: "Stage Capabilities", tactic: "Resource Development", description: "Uploading malware or tools to attacker-controlled infrastructure, ready for use." },

  // Initial Access
  { id: "T1189", name: "Drive-by Compromise", tactic: "Initial Access", description: "Compromising a system just by having it browse a malicious/compromised website." },
  { id: "T1190", name: "Exploit Public-Facing Application", tactic: "Initial Access", description: "Exploiting a bug in an internet-facing app or service to gain a foothold." },
  { id: "T1133", name: "External Remote Services", tactic: "Initial Access", description: "Abusing VPN, RDP, or other remote-access services to get in." },
  { id: "T1200", name: "Hardware Additions", tactic: "Initial Access", description: "Introducing malicious hardware (rogue USB, network implant) for access." },
  { id: "T1566", name: "Phishing", tactic: "Initial Access", description: "Malicious email/message with an attachment or link that delivers the initial payload." },
  { id: "T1091", name: "Replication Through Removable Media", tactic: "Initial Access", description: "Spreading via infected USB drives and other removable media." },
  { id: "T1195", name: "Supply Chain Compromise", tactic: "Initial Access", description: "Tampering with a product or its update mechanism before it reaches the victim." },
  { id: "T1199", name: "Trusted Relationship", tactic: "Initial Access", description: "Abusing a trusted third party (vendor, MSP) that already has access to the target." },
  { id: "T1078", name: "Valid Accounts", tactic: "Initial Access", description: "Using legitimate, stolen, or default credentials to log in like a real user." },

  // Execution
  { id: "T1059", name: "Command and Scripting Interpreter", tactic: "Execution", description: "Running commands via shells/interpreters (PowerShell, bash, Python, JS) to execute code." },
  { id: "T1609", name: "Container Administration Command", tactic: "Execution", description: "Using a container's own management interface to run commands inside it." },
  { id: "T1203", name: "Exploitation for Client Execution", tactic: "Execution", description: "Exploiting a bug in client software (browser, Office) to run attacker code." },
  { id: "T1053", name: "Scheduled Task/Job", tactic: "Execution", description: "Using cron/Task Scheduler to run code now, later, or on a recurring basis." },
  { id: "T1204", name: "User Execution", tactic: "Execution", description: "Relying on the victim to run/open a malicious file or link themselves." },
  { id: "T1047", name: "Windows Management Instrumentation", tactic: "Execution", description: "Using WMI to execute code and gather info on Windows systems." },
  { id: "T1569", name: "System Services", tactic: "Execution", description: "Abusing service-control mechanisms (like Windows Services) to execute code." },

  // Persistence
  { id: "T1098", name: "Account Manipulation", tactic: "Persistence", description: "Modifying account permissions/credentials to maintain access over time." },
  { id: "T1547", name: "Boot or Logon Autostart Execution", tactic: "Persistence", description: "Configuring software to run automatically at system boot or user logon." },
  { id: "T1136", name: "Create Account", tactic: "Persistence", description: "Creating a new local, domain, or cloud account as a persistent foothold." },
  { id: "T1543", name: "Create or Modify System Process", tactic: "Persistence", description: "Installing/modifying a service or daemon so it keeps running." },
  { id: "T1546", name: "Event Triggered Execution", tactic: "Persistence", description: "Hooking system events (file changes, logon) to re-trigger malicious code." },
  { id: "T1574", name: "Hijack Execution Flow", tactic: "Persistence", description: "Redirecting a legitimate program's execution path to run attacker code instead." },
  { id: "T1556", name: "Modify Authentication Process", tactic: "Persistence", description: "Tampering with login mechanisms (PAM, auth DLLs) for backdoor access." },
  { id: "T1505", name: "Server Software Component", tactic: "Persistence", description: "Installing a malicious component (web shell, plugin) into server software." },

  // Privilege Escalation
  { id: "T1548", name: "Abuse Elevation Control Mechanism", tactic: "Privilege Escalation", description: "Bypassing UAC/sudo controls to run with higher privileges." },
  { id: "T1134", name: "Access Token Manipulation", tactic: "Privilege Escalation", description: "Stealing or forging access tokens to act as another, more privileged user." },
  { id: "T1055", name: "Process Injection", tactic: "Privilege Escalation", description: "Injecting code into another process's memory to run with its privileges and evade detection." },
  { id: "T1068", name: "Exploitation for Privilege Escalation", tactic: "Privilege Escalation", description: "Exploiting an OS or software bug to gain higher-level permissions." },
  { id: "T1484", name: "Domain or Tenant Policy Modification", tactic: "Privilege Escalation", description: "Changing group policy or cloud tenant policy to grant broader access." },

  // Defense Evasion
  { id: "T1070", name: "Indicator Removal", tactic: "Defense Evasion", description: "Deleting logs, files, or other artifacts that would reveal the attack." },
  { id: "T1027", name: "Obfuscated Files or Information", tactic: "Defense Evasion", description: "Encoding, encrypting, or packing payloads so they aren't recognized." },
  { id: "T1036", name: "Masquerading", tactic: "Defense Evasion", description: "Naming or signing malicious files to look like legitimate, trusted ones." },
  { id: "T1562", name: "Impair Defenses", tactic: "Defense Evasion", description: "Disabling or tampering with security tools like AV, EDR, or firewalls." },
  { id: "T1140", name: "Deobfuscate/Decode Files or Information", tactic: "Defense Evasion", description: "Decoding payloads only at runtime so static scanners see nothing suspicious." },
  { id: "T1218", name: "System Binary Proxy Execution", tactic: "Defense Evasion", description: "Abusing trusted, signed OS binaries (LOLBins) to run malicious code." },
  { id: "T1497", name: "Virtualization/Sandbox Evasion", tactic: "Defense Evasion", description: "Detecting analysis sandboxes/VMs and behaving differently to avoid detection." },
  { id: "T1112", name: "Modify Registry", tactic: "Defense Evasion", description: "Changing Windows Registry keys to hide configuration or disable defenses." },

  // Credential Access
  { id: "T1110", name: "Brute Force", tactic: "Credential Access", description: "Guessing passwords via exhaustive or dictionary-based attempts." },
  { id: "T1555", name: "Credentials from Password Stores", tactic: "Credential Access", description: "Pulling saved passwords from browsers, password managers, or OS credential stores." },
  { id: "T1003", name: "OS Credential Dumping", tactic: "Credential Access", description: "Extracting hashed or plaintext credentials from OS memory/files (e.g. LSASS)." },
  { id: "T1552", name: "Unsecured Credentials", tactic: "Credential Access", description: "Finding credentials left in plaintext — config files, scripts, history, notes." },
  { id: "T1621", name: "Multi-Factor Authentication Request Generation", tactic: "Credential Access", description: "MFA fatigue/push-bombing — spamming approval prompts until one gets accepted." },
  { id: "T1558", name: "Steal or Forge Kerberos Tickets", tactic: "Credential Access", description: "Kerberoasting and related attacks to obtain or forge authentication tickets." },

  // Discovery
  { id: "T1087", name: "Account Discovery", tactic: "Discovery", description: "Enumerating local, domain, or cloud accounts on a compromised system." },
  { id: "T1082", name: "System Information Discovery", tactic: "Discovery", description: "Gathering OS version, hardware, and configuration details post-compromise." },
  { id: "T1083", name: "File and Directory Discovery", tactic: "Discovery", description: "Browsing the filesystem to find files/directories of interest." },
  { id: "T1046", name: "Network Service Discovery", tactic: "Discovery", description: "Scanning for other services/hosts reachable from a compromised machine." },
  { id: "T1057", name: "Process Discovery", tactic: "Discovery", description: "Listing running processes — often to spot security tools to avoid." },
  { id: "T1018", name: "Remote System Discovery", tactic: "Discovery", description: "Enumerating other systems on the network to plan lateral movement." },
  { id: "T1518", name: "Software Discovery", tactic: "Discovery", description: "Enumerating installed software, especially security products." },
  { id: "T1069", name: "Permission Groups Discovery", tactic: "Discovery", description: "Enumerating security groups to find high-privilege targets." },

  // Lateral Movement
  { id: "T1021", name: "Remote Services", tactic: "Lateral Movement", description: "Using RDP, SSH, SMB, or WinRM with valid credentials to move to another system." },
  { id: "T1570", name: "Lateral Tool Transfer", tactic: "Lateral Movement", description: "Copying tools/malware from one compromised host to another." },
  { id: "T1550", name: "Use Alternate Authentication Material", tactic: "Lateral Movement", description: "Using stolen tokens, hashes, or tickets instead of a plaintext password (pass-the-hash etc.)." },
  { id: "T1080", name: "Taint Shared Content", tactic: "Lateral Movement", description: "Planting malicious files on shared drives so others who open them get infected." },
  { id: "T1210", name: "Exploitation of Remote Services", tactic: "Lateral Movement", description: "Exploiting a vulnerability in a remote service to move laterally." },

  // Collection
  { id: "T1560", name: "Archive Collected Data", tactic: "Collection", description: "Compressing/encrypting gathered data before exfiltration." },
  { id: "T1119", name: "Automated Collection", tactic: "Collection", description: "Using scripts to automatically gather files/data of interest at scale." },
  { id: "T1005", name: "Data from Local System", tactic: "Collection", description: "Searching a local system for files worth stealing." },
  { id: "T1039", name: "Data from Network Shared Drive", tactic: "Collection", description: "Collecting files from shared/network drives." },
  { id: "T1113", name: "Screen Capture", tactic: "Collection", description: "Taking screenshots of the victim's desktop." },
  { id: "T1123", name: "Audio Capture", tactic: "Collection", description: "Recording audio via the victim's microphone." },
  { id: "T1114", name: "Email Collection", tactic: "Collection", description: "Harvesting emails from a mailbox or mail client." },
  { id: "T1056", name: "Input Capture", tactic: "Collection", description: "Keylogging or intercepting other forms of user input." },

  // Command and Control
  { id: "T1071", name: "Application Layer Protocol", tactic: "Command and Control", description: "Hiding C2 traffic inside normal protocols like HTTP/HTTPS/DNS." },
  { id: "T1132", name: "Data Encoding", tactic: "Command and Control", description: "Encoding C2 traffic (base64 etc.) to evade content inspection." },
  { id: "T1573", name: "Encrypted Channel", tactic: "Command and Control", description: "Encrypting C2 traffic so its contents can't be inspected in transit." },
  { id: "T1105", name: "Ingress Tool Transfer", tactic: "Command and Control", description: "Downloading additional tools/malware onto a compromised host." },
  { id: "T1095", name: "Non-Application Layer Protocol", tactic: "Command and Control", description: "Using raw TCP/UDP/ICMP instead of a standard application protocol for C2." },
  { id: "T1572", name: "Protocol Tunneling", tactic: "Command and Control", description: "Tunneling one protocol inside another to evade network controls." },
  { id: "T1090", name: "Proxy", tactic: "Command and Control", description: "Routing C2 traffic through an intermediary to hide the true destination." },
  { id: "T1102", name: "Web Service", tactic: "Command and Control", description: "Using legitimate web services (social media, cloud storage) as a C2 channel." },

  // Exfiltration
  { id: "T1020", name: "Automated Exfiltration", tactic: "Exfiltration", description: "Scripted, automatic exfiltration of collected data on a schedule or trigger." },
  { id: "T1030", name: "Data Transfer Size Limits", tactic: "Exfiltration", description: "Splitting exfiltrated data into small chunks to stay under detection thresholds." },
  { id: "T1048", name: "Exfiltration Over Alternative Protocol", tactic: "Exfiltration", description: "Exfiltrating over a different protocol than the main C2 channel uses." },
  { id: "T1041", name: "Exfiltration Over C2 Channel", tactic: "Exfiltration", description: "Sending stolen data out over the same channel used for command and control." },
  { id: "T1567", name: "Exfiltration Over Web Service", tactic: "Exfiltration", description: "Using a legitimate cloud service (Dropbox, Drive) as the exfiltration destination." },
  { id: "T1029", name: "Scheduled Transfer", tactic: "Exfiltration", description: "Exfiltrating data only at set times to blend in with normal traffic patterns." },

  // Impact
  { id: "T1531", name: "Account Access Removal", tactic: "Impact", description: "Locking out legitimate users by changing passwords or deleting accounts." },
  { id: "T1485", name: "Data Destruction", tactic: "Impact", description: "Permanently destroying files or systems to disrupt operations." },
  { id: "T1486", name: "Data Encrypted for Impact", tactic: "Impact", description: "Ransomware — encrypting data and demanding payment for the key." },
  { id: "T1490", name: "Inhibit System Recovery", tactic: "Impact", description: "Deleting backups/shadow copies so a victim can't simply restore and recover." },
  { id: "T1498", name: "Network Denial of Service", tactic: "Impact", description: "Flooding a network/service with traffic to make it unavailable." },
  { id: "T1489", name: "Service Stop", tactic: "Impact", description: "Stopping critical services/processes to disrupt operations." },
  { id: "T1491", name: "Defacement", tactic: "Impact", description: "Altering visible content (like a website) to make a statement or cause disruption." },
];
