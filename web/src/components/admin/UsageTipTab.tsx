import { useEffect, useRef, useState } from 'react';
import { saveUsageTips } from '../../api/materials';
import { USAGE_TIP_MAX_CHARS, USAGE_TIP_MAX_COUNT, clampUsageTip, usageTipRows } from '../../domain/usageTip';
import { messageOf } from '../../services/runtime';
import { useAdmin } from '../../state/admin';
import { useApp } from '../../state/app';
import { Button } from '../common/Button';

export function UsageTipTab() {
  const settings = useAdmin((state) => state.settings);
  const limit = useApp((state) => state.usageTipLimit);
  const width = useApp((state) => state.usageTipWidth);
  const [rows, setRows] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);
  const source = useRef<string[] | null>(null);

  useEffect(() => {
    if (!settings || source.current) return;
    const saved = (settings.usageTips ?? []).map((tip) => tip.trim()).filter(Boolean);
    source.current = saved.length ? saved : [''];
    setRows(usageTipRows(source.current, USAGE_TIP_MAX_CHARS));
  }, [settings]);

  const change = (index: number, value: string) => {
    setRows((current) => current.map((tip, item) => (item === index ? clampUsageTip(value, USAGE_TIP_MAX_CHARS) : tip)));
  };

  const add = () => {
    if (rows.length >= USAGE_TIP_MAX_COUNT) return;
    setRows((current) => [...current, '']);
  };

  const remove = (index: number) => {
    setRows((current) => {
      const next = current.filter((_, item) => item !== index);
      return next.length ? next : [''];
    });
  };

  const save = () => {
    const profile = useApp.getState().profile;
    if (profile?.role !== 'admin' || !settings || saving) return;
    const tips = rows.map((tip) => clampUsageTip(tip, USAGE_TIP_MAX_CHARS).trim()).filter(Boolean);
    setSaving(true);
    void saveUsageTips(tips)
      .then((usageTips) => {
        const saved = usageTips.map((tip) => clampUsageTip(tip, USAGE_TIP_MAX_CHARS));
        source.current = saved.length ? saved : [''];
        setRows(usageTipRows(source.current, USAGE_TIP_MAX_CHARS));
        const admin = useAdmin.getState().settings;
        if (admin) useAdmin.getState().patch({ settings: { ...admin, usageTips: saved } });
        const config = useApp.getState().config;
        if (config) useApp.getState().patch({ config: { ...config, usageTips: saved } });
        useApp.getState().toast('사용 Tip을 저장했습니다.');
      })
      .catch((error: unknown) => useApp.getState().toast(messageOf(error)))
      .finally(() => setSaving(false));
  };

  const fieldWidth = Math.max(420, width + 22);

  return (
    <section className="usage-tip-editor">
      <h2>사용 Tip</h2>
      <p className="help">헤더에 두 줄까지 표시하며, 문장 길이에 따라 6~20초 동안 보여 줍니다. 마우스를 올리거나 화살표에 초점을 두면 자동 넘김이 멈춥니다. 화살표로 이전·다음 팁을 볼 수 있습니다.</p>
      <p id="usage-tip-limit" className="help">
        {`${USAGE_TIP_MAX_CHARS}자 이내로 입력`}
        {limit > 0 && ` · 현재 화면에서 두 줄에 읽기 편한 길이는 약 ${limit}자입니다.`}
      </p>
      <div className="usage-tip-rows">
        {rows.map((tip, index) => (
          <div className="usage-tip-row" key={index}>
            <textarea
              className="usage-tip-input"
              style={{ width: fieldWidth, maxWidth: '100%' }}
              aria-label={`사용 Tip ${index + 1}`}
              aria-describedby="usage-tip-limit"
              value={tip}
              maxLength={USAGE_TIP_MAX_CHARS}
              rows={2}
              disabled={!settings || saving}
              onChange={(event) => change(index, event.target.value)}
            />
            <small className="usage-tip-count">{[...tip].length}/{USAGE_TIP_MAX_CHARS}</small>
            <button className="btn btn-line btn-sm" type="button" disabled={saving} onClick={() => remove(index)}>
              삭제
            </button>
          </div>
        ))}
      </div>
      <div className="usage-tip-actions">
        <button
          className="btn btn-line btn-sm usage-tip-add"
          type="button"
          aria-label="사용 Tip 추가"
          disabled={!settings || saving || rows.length >= USAGE_TIP_MAX_COUNT}
          onClick={add}
        >
          +
        </button>
        <Button variant="primary" type="button" disabled={!settings || saving} onClick={save}>
          사용 Tip 저장
        </Button>
      </div>
    </section>
  );
}
