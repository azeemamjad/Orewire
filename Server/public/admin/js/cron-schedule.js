/** User-friendly schedule fields → cron expression helpers (admin UI). */

function cronReadBuilder(prefix) {
  const freq = document.getElementById(`${prefix}-freq`)?.value || 'daily';
  const hour = parseInt(document.getElementById(`${prefix}-hour`)?.value, 10);
  const minute = parseInt(document.getElementById(`${prefix}-minute`)?.value, 10);
  const hours = parseInt(document.getElementById(`${prefix}-hours`)?.value, 10);
  const dow = parseInt(document.getElementById(`${prefix}-dow`)?.value, 10);
  return {
    frequency: freq,
    hour: Number.isFinite(hour) ? hour : 6,
    minute: Number.isFinite(minute) ? minute : 0,
    hours: Number.isFinite(hours) ? hours : 3,
    dayOfWeek: Number.isFinite(dow) ? dow : 1,
  };
}

function cronApplyBuilder(prefix, parts) {
  const p = parts || { frequency: 'daily', hour: 6, minute: 0, hours: 3, dayOfWeek: 1 };
  const freqEl = document.getElementById(`${prefix}-freq`);
  if (freqEl) freqEl.value = p.frequency || 'daily';
  const hourEl = document.getElementById(`${prefix}-hour`);
  if (hourEl) hourEl.value = p.hour ?? 6;
  const minEl = document.getElementById(`${prefix}-minute`);
  if (minEl) minEl.value = p.minute ?? 0;
  const hoursEl = document.getElementById(`${prefix}-hours`);
  if (hoursEl) hoursEl.value = p.hours ?? 3;
  const dowEl = document.getElementById(`${prefix}-dow`);
  if (dowEl) dowEl.value = p.dayOfWeek ?? 1;
  cronToggleBuilderFields(prefix);
}

function cronToggleBuilderFields(prefix) {
  const freq = document.getElementById(`${prefix}-freq`)?.value || 'daily';
  const daily = document.getElementById(`${prefix}-daily-fields`);
  const weekly = document.getElementById(`${prefix}-weekly-fields`);
  const hourly = document.getElementById(`${prefix}-hourly-fields`);
  if (daily) daily.style.display = freq === 'daily' || freq === 'weekly' ? 'grid' : 'none';
  if (weekly) weekly.style.display = freq === 'weekly' ? 'block' : 'none';
  if (hourly) hourly.style.display = freq === 'every_hours' ? 'block' : 'none';
}

function cronDescribe(parts) {
  if (!parts) return '—';
  if (parts.frequency === 'every_hours') {
    return `Every ${parts.hours || 3} hour(s)`;
  }
  if (parts.frequency === 'weekly') {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const t = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
    return `Weekly on ${days[parts.dayOfWeek] || 'Monday'} at ${t}`;
  }
  const t = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  return `Daily at ${t}`;
}

function cronBuilderHtml(prefix, label) {
  return `
  <div class="config-field" style="grid-column:1/-1;">
    <label>${label}</label>
    <div class="cron-builder">
      <div class="config-field">
        <label>Frequency</label>
        <select id="${prefix}-freq" onchange="cronToggleBuilderFields('${prefix}')">
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="every_hours">Every X hours</option>
        </select>
      </div>
      <div id="${prefix}-hourly-fields" style="display:none;">
        <div class="config-field">
          <label>Every (hours)</label>
          <input id="${prefix}-hours" type="number" min="1" max="23" value="3" />
        </div>
      </div>
      <div id="${prefix}-daily-fields" class="cron-builder" style="grid-column:span 2;">
        <div class="config-field">
          <label>Hour (0–23)</label>
          <input id="${prefix}-hour" type="number" min="0" max="23" value="6" />
        </div>
        <div class="config-field">
          <label>Minute (0–59)</label>
          <input id="${prefix}-minute" type="number" min="0" max="59" value="0" />
        </div>
      </div>
      <div id="${prefix}-weekly-fields" style="display:none;">
        <div class="config-field">
          <label>Day of week</label>
          <select id="${prefix}-dow">
            <option value="0">Sunday</option>
            <option value="1">Monday</option>
            <option value="2">Tuesday</option>
            <option value="3">Wednesday</option>
            <option value="4">Thursday</option>
            <option value="5">Friday</option>
            <option value="6">Saturday</option>
          </select>
        </div>
      </div>
    </div>
    <div class="cron-preview" id="${prefix}-preview">—</div>
  </div>`;
}
