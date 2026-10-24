function localDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function localDateTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function parseLocalDateTime(value) {
  if (typeof value !== 'string') throw new Error('Choose a valid local date and time.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Choose a valid local date and time.');
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || hour > 23
    || minute > 59
  ) throw new Error('Choose a valid local date and time.');
  return { year, month, day, hour, minute };
}

function localDateTimeToUtc(parts, timeZone) {
  const naiveUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let candidate = naiveUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const local = localDateTimeParts(new Date(candidate), timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    candidate = naiveUtc - (localAsUtc - candidate);
  }
  const actual = localDateTimeParts(new Date(candidate), timeZone);
  if (
    actual.year !== parts.year
    || actual.month !== parts.month
    || actual.day !== parts.day
    || actual.hour !== parts.hour
    || actual.minute !== parts.minute
  ) {
    throw new Error('That local time does not exist because of a daylight-saving change. Choose another time.');
  }
  return new Date(candidate);
}

function nextDailyRun(localTime, timeZone, now = new Date()) {
  if (typeof localTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) {
    throw new Error('Choose a valid daily send time.');
  }
  const [hour, minute] = localTime.split(':').map(Number);
  const date = localDateParts(now, timeZone);
  let parts = { ...date, hour, minute };
  let next = localDateTimeToUtc(parts, timeZone);
  if (next <= now) {
    const tomorrow = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
    parts = {
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
      hour,
      minute,
    };
    next = localDateTimeToUtc(parts, timeZone);
  }
  return next;
}

function scheduledLocalTimeToUtc(value, timeZone) {
  const scheduledAt = localDateTimeToUtc(parseLocalDateTime(value), timeZone);
  if (scheduledAt.getTime() < Date.now() + 30_000) {
    throw new Error('Choose a send time at least 30 seconds in the future.');
  }
  return scheduledAt;
}

module.exports = {
  localDateTimeToUtc,
  nextDailyRun,
  scheduledLocalTimeToUtc,
};
