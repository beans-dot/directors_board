const OFFICES = ['기획', '교무', '입학', '학생', '산학', '행정'];
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

function officeRank(name) {
  const office = /[[［]\s*(기획|교무|입학|학생|산학|행정)/.exec(name)?.[1];
  const index = OFFICES.indexOf(office || '');
  return index < 0 ? OFFICES.length : index;
}

export function compareAttachmentNames(a, b) {
  const rank = officeRank(a) - officeRank(b);
  if (rank) return rank;
  const aNum = /^\d/.test(a);
  const bNum = /^\d/.test(b);
  if (aNum !== bNum) return aNum ? -1 : 1;
  return collator.compare(a, b);
}

export function manualOrderKey(meetingId, category) {
  return `fileOrderManual:${meetingId}:${category}`;
}

export function sortUploadedAttachments(store, meetingId) {
  if (store.setting(manualOrderKey(meetingId, '별첨')) === '1') return;
  const files = store.filesFor(meetingId).filter((file) => file.category === '별첨');
  files.sort((a, b) => compareAttachmentNames(a.name, b.name));
  files.forEach((file, index) => store.setSort(file.id, index + 1));
}

// Older releases saved manual order without recording whether it was manual.
// Preserve existing groups once; new groups use automatic ordering until edited.
export function preserveExistingOrder(store) {
  if (store.setting('fileOrderVersion') === '1') return;
  store.tx(() => {
    for (const meeting of store.meetings()) {
      if (store.filesFor(meeting.id).some((file) => file.category === '별첨')) {
        store.putSetting(manualOrderKey(meeting.id, '별첨'), '1');
      }
    }
    store.putSetting('fileOrderVersion', '1');
  });
}
