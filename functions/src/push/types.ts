export type PaymentRecordedNotification = {
  id: string;
  module: "payments";
  event: "payment_recorded";
  destination: "/dashboard";
  recipientRole: "parent";
  type: "payment";
  schoolId: string;
  schoolYearId: string;
  parentId: string;
  studentId: string;
};

export type ParentRecord = {
  id: string;
  schoolId?: string;
  schoolYearId?: string;
  studentIds?: string[];
  status?: string;
};

export type StudentRecord = {
  id: string;
  schoolId?: string;
  schoolYearId?: string;
  parentId?: string;
  className?: string;
  option?: string;
};

export type ParentUserRecord = {
  id: string;
  role?: string;
  schoolId?: string;
  activeSchoolYearId?: string;
  parentId?: string;
  status?: string;
};

export type PushTokenRecord = {
  id: string;
  token?: string;
  active?: boolean;
  userId?: string;
};

export type ResolvedPaymentRecipient = {
  userId: string;
  tokens: PushTokenRecord[];
};

export type MessageRecipient = "admin" | "cashier" | "discipline" | "both";
export type MessagePushEvent = "school_message_received" | "parent_message_received";

export type MessageNotificationRecord = {
  id: string;
  type: "message";
  recipientRole: "parent" | "school";
  schoolId: string;
  schoolYearId: string;
  parentId?: string;
  schoolRecipient?: MessageRecipient;
  messageId: string;
};

export type MessageRecord = {
  id: string;
  schoolId?: string;
  schoolYearId?: string;
  senderId?: string;
  recipientParentId?: string;
  threadParentId?: string;
  threadId?: string;
  conversationId?: string;
  schoolRecipient?: MessageRecipient;
};

export type SchoolUserRecord = ParentUserRecord & { role?: string };

export type ResolvedMessageDispatch = {
  event: MessagePushEvent;
  parentId: string;
  schoolRecipient?: MessageRecipient;
  recipients: ResolvedPaymentRecipient[];
};

export type OperationalPushEvent = "student_absent" | "student_late" | "discipline_incident_created" | "announcement_published";
export type OperationalPushModule = "attendance" | "discipline" | "announcements";

export type OperationalNotificationRecord = {
  id: string;
  module: OperationalPushModule;
  event: OperationalPushEvent;
  schoolId: string;
  schoolYearId: string;
  parentId?: string;
  studentId?: string;
  attendanceId?: string;
  disciplineSanctionId?: string;
  announcementId?: string;
  audienceRoles?: string[];
  audienceParentIds?: string[];
  audienceSchoolWide?: boolean;
};

export type AttendanceRecord = { id: string; schoolId?: string; schoolYearId?: string; studentId?: string; status?: string };
export type DisciplineRecord = { id: string; schoolId?: string; schoolYearId?: string; studentId?: string };
export type AnnouncementRecord = { id: string; schoolId?: string; schoolYearId?: string; visibility?: string; targetClassKey?: string };
export type OperationalDispatch = {
  module: OperationalPushModule;
  event: OperationalPushEvent;
  recipients: ResolvedPaymentRecipient[];
};
