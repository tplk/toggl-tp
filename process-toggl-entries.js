#!/usr/bin/env node
const fetch = require('node-fetch');
const readline = require('readline');

const dateOffset = parseInt(process.argv[2]) || 0;

//TODO refactor into a single config.
const togglToken = process.env.TOGGL_API_TOKEN;
const targetProcessToken = process.env.TARGET_PROCESS_API_TOKEN;
const targetProcessUrl= process.env.TARGET_PROCESS_URL;
const defaultTask = parseInt(process.env.TARGET_PROCESS_DEFAULT_TASK);
const userId = parseInt(process.env.TARGET_PROCESS_USER_ID);
const projectId = parseInt(process.env.TARGET_PROCESS_PROJECT_ID);

if (!togglToken || !targetProcessToken) {
  throw new Error('Missing API token!');
}

function setDateToMidnight(date) {
  date.setHours(0,0,0,0)
}

function offsetDate(date, delta) {
  date.setDate(date.getDate() + delta);
}

function toTogglDateFormat(date) {
  return date.toISOString().split('.')[0] + '+00:00';
}

function toBasicAuth(username, password) {
  return 'Basic ' + Buffer.from(username + ":" + password).toString('base64');
}

async function getEntries(offset = 0) {
  const today = new Date();
  setDateToMidnight(today);
  offsetDate(today, offset);
  const tomorrow = new Date(today);
  offsetDate(tomorrow, 1);
  tomorrow.setSeconds(-1);

  const params = new URLSearchParams({
    start_date: toTogglDateFormat(today),
    end_date: toTogglDateFormat(tomorrow),
  });

  return fetch(
    'https://www.toggl.com/api/v8/time_entries?' + params,
    {
      method: 'GET',
      headers: {
        Authorization: toBasicAuth(togglToken, 'api_token'),
      },
    },
  )
    .then(res => res.json());
}

async function logEntries(entries) {
  const params = new URLSearchParams({
    access_token: targetProcessToken,
    resultFormat: 'json',
  });


  return Promise.all(entries.map(entry => {
    const body = {
      Spent: entry.time,
      Assignable: { Id: entry.task },
      Description: entry.text,
      Date: `/Date(${entry.date.getTime()}+0000)/`,
    };

    return fetch(
      `${targetProcessUrl}/api/v1/Time?` + params,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {'Content-Type': 'application/json'},
      }
    )
      .then(res => res.json())
      .catch(err => console.error(err));
  }));
}

// Parsing
function parseDescription(description) {
  if (typeof description !== 'string' || description.length < 1) {
    throw new Error(`Description can't be empty! Got ${JSON.stringify(description)}`);
  }

  const [_, id, title] = description.match(/^\#([0-9]{4}) (.+)/) || [];

  return {task: parseInt(id) || defaultTask, text: title || description};
}

function truncateTime(time) {
  return parseFloat(time.toFixed(2));
}

function parseDuration(dur) {
  const hours = dur / 3600;
  return truncateTime(hours);
}

function parseDate(dateString) {
  return new Date(dateString);
}

async function main() {
  let entries = await getEntries(dateOffset);

  entries = entries.reduce((map, entry) => {
      if (entry.duration == null || entry.duration <= 0) {
        return map;
      }

      const { task, text } = parseDescription(entry.description);
      const time = parseDuration(entry.duration);
      const date = parseDate(entry.stop);
      const entryId = `${task}_${text}`;

      if (!map[entryId]) {
        map[entryId] = {task, text, time, count: 1, date};
      } else {
        const cur = map[entryId];

        map[entryId] = {
          ...cur,
          time: truncateTime(cur.time + time),
          count: ++cur.count,
          date: cur.date > date ? cur.date : date,
        };
      }

      return map;
    }, {});

  entries = Object.values(entries);

  console.log(entries);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Proceed(y/n)? ', async answer => {
    rl.close();

    if (answer === 'y') {
      const res = await logEntries(entries);
      console.log(res);
    }
  });
}

main();
