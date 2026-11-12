export type ISODate = string;
export type FolderDate = string;
export type Role = 'user' | 'admin';

export interface Officer {
  id: string;
  position: string;
  name: string;
  email: string;
  employeeNo?: string;
  mustChangePassword?: boolean;
  ready?: boolean;
}

export interface LoginLock {
  key: string;
  kind: 'account' | 'address';
  name: string;
  position: string;
  lockedUntil: number;
}

export interface DriveNode {
  id: string;
  name: string;
  kind: 'folder' | 'file';
  mimeType: string;
  isPdf: boolean;
  modifiedTime?: ISODate;
  md5Checksum?: string;
  size?: number;
  path: string;
  children?: DriveNode[];
}

export interface DateFolder extends DriveNode {
  kind: 'folder';
  folderDate: FolderDate;
  dateKey: string;
}

export interface Profile {
  deviceId: string;
  name: string;
  position: string;
  role: Role;
  officerId?: string;
  mustChangePassword?: boolean;
  adminToken?: string;
  adminTokenExp?: number;
  savedEmail?: string;
  createdAt: ISODate;
  registeredAt?: ISODate;
}

export interface LocalFile {
  driveFileId: string;
  path: string;
  folderDate: FolderDate;
  topFolder: string;
  name: string;
  modifiedTime: ISODate;
  md5?: string;
  size?: number;
  currentBlobKey?: string;
  pageCount?: number;
  versions: Array<{
    blobKey: string;
    modifiedTime: ISODate;
    md5?: string;
    replacedAt: ISODate;
    driveFileId: string;
  }>;
  downloadedAt?: ISODate;
  lastOpenedAt?: ISODate;
}

export interface PdfBlobRecord {
  key: string;
  blob: Blob;
  savedAt: ISODate;
}

export type AnnotationType = 'pin' | 'highlight' | 'underline' | 'ink';

export interface Annotation {
  id: string;
  driveFileId: string;
  path: string;
  folderDate: FolderDate;
  topFolder: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  type: AnnotationType;
  content: string;
  inkPaths?: Array<Array<[number, number]>>;
  color?: string;
  status: 'active' | 'deleted';
  version: number;
  movedFromVersion?: { modifiedTime: ISODate; md5?: string; driveFileId: string };
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface AnnotationRevision {
  annotationId: string;
  version: number;
  action: 'create' | 'update' | 'delete' | 'migrate' | 'restore';
  snapshot: Omit<Annotation, 'id'>;
  at: ISODate;
}

export interface TreeSnapshot {
  fetchedAt: ISODate;
  root: DateFolder[];
  seenFolderIds: string[];
  seenFileIds: string[];
}

export interface SendRecord {
  folderDate: FolderDate;
  to: string;
  subject: string;
  fileCount: number;
  totalBytes: number;
  mode: 'attach' | 'link';
  ok: boolean;
  error?: string;
  at: ISODate;
}

export interface OutboxEvent {
  action: string;
  folderDate?: FolderDate;
  target?: string;
  at: ISODate;
}

export interface MemoBackupPayload {
  format: 'bojik-memo-backup';
  schemaVersion: 1;
  deviceId: string;
  profile: { name: string; position: string };
  createdAt: ISODate;
  scope: 'all' | { folderDate: FolderDate };
  folders: Array<{
    folderDate: FolderDate;
    files: Array<{
      driveFileId: string;
      path: string;
      name: string;
      modifiedTime: ISODate;
      md5?: string;
      annotations: Annotation[];
      revisions: AnnotationRevision[];
    }>;
  }>;
  checksum: string;
}

export interface MemoBackupRecord {
  id: string;
  createdAt: ISODate;
  reason: 'auto' | 'manual' | 'before-restore';
  sizeBytes: number;
  annotationCount: number;
  data: MemoBackupPayload;
  diskSaved?: 'folder' | 'download' | 'none';
}

export interface BackupSettings {
  retentionDays: number;
  maxTotalBytes: number;
  diskMode: 'folder' | 'download' | 'off';
  lastAutoBackupAt?: ISODate;
  lastDiskBackupAt?: ISODate;
}

export interface MeetingFolderRef {
  folderDate: string;
  dateKey: string;
  folderId: string;
  url: string;
}

export interface ChangeNotice {
  fileId: string;
  path: string;
}

export interface PublicConfig {
  today: FolderDate;
  maxAttachBytes: number;
  allowedRecipientDomain: string;
  officers?: Officer[];
  meetingDate?: string;
  meetingTime?: string;
  changeNotices?: ChangeNotice[];
  usageTips?: string[];
}

export interface AdminSettings {
  rootFolderSet: boolean;
  rootFolderName: string;
  resultFolderSet?: boolean;
  resultFolderName?: string;
  queueFolderSet?: boolean;
  queueFolderName?: string;
  packFolderSet?: boolean;
  packFolderName?: string;
  senderEmail: string;
  aliases: string[];
  mailFromName: string;
  mailFromAlias: string;
  officers?: Officer[];
  meetingDate?: string;
  meetingTime?: string;
  meetingAuto?: boolean;
  meetingAutoWeekday?: number;
  meetingAutoTime?: string;
  dateFolders?: MeetingFolderRef[];
  meetings?: MeetingRecord[];
  usageTips?: string[];
}

export interface MeetingFileRecord {
  id: string;
  name: string;
  category: string;
  sortOrder: number;
  size: number;
}

export interface MeetingRecord {
  id: string;
  dateKey: string;
  folderDate: string;
  time: string;
  title: string;
  files: MeetingFileRecord[];
}

export interface DeviceRow {
  deviceId: string;
  name: string;
  position: string;
  firstSeen: string;
  lastSeen: string;
  browser: string;
  admin: string;
}

export interface AccessRow {
  deviceId: string;
  name: string;
  folderDate: string;
  action: string;
  target: string;
  at: string;
}

export interface SendLogRow {
  deviceId: string;
  name: string;
  folderDate: string;
  to: string;
  fileCount: number;
  bytes: number;
  mode: string;
  result: string;
  error: string;
  at: string;
}

export interface FilePayload {
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  md5Checksum?: string;
  size?: number;
  base64: string;
}

export interface GasOk<T> {
  ok: true;
  data: T;
  serverTime: string;
}

export interface GasFail {
  ok: false;
  error: { code: string; message: string };
  serverTime: string;
}
