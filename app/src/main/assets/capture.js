'use strict';
// One editor draft and delivery receipts are written atomically. A shared text
// stays in Android's durable inbox until this record has been written.
const CAPTURE_KEY = 'lexicards-editor-v1';
const CARD_FIELDS = {word:'fWord',translation:'fTranslation',ipa:'fIpa',example:'fExample',exampleRu:'fExampleRu',deck:'fDeck'};
let pendingSharedRequest = null, shareRetryTimer = null;
function captureEnvelope() {
 const raw = localStorage.getItem(CAPTURE_KEY);
 if (!raw) return {version:1,draft:null,receivedShares:[]};
 const state = JSON.parse(raw);
 if (state.version !== 1 || !Array.isArray(state.receivedShares)) throw new Error('Не удалось прочитать черновик.');
 return state;
}
function formFields() {
 const fields = {};
 for (const [key,id] of Object.entries(CARD_FIELDS)) fields[key] = $(id).value;
 return fields;
}
function hasDraftText(fields) {
 return Object.keys(CARD_FIELDS).some(key => key !== 'deck' && String(fields[key] || '').trim());
}
function writeCaptureEnvelope(state) {
 localStorage.setItem(CAPTURE_KEY,JSON.stringify(state));
 updateDraftResume(state);
}
function draftStatus(message,failed = false) {
 $('draftStatus').textContent = message;
 $('draftStatus').style.color = failed ? 'var(--red)' : '';
}
function rememberCardDraft() {
 try {
  const state = captureEnvelope(), fields = formFields();
  state.draft = hasDraftText(fields) || editing ? {editing,fields} : null;
  writeCaptureEnvelope(state);
  draftStatus(state.draft ? 'Черновик сохранён. Можно вернуться в другое приложение и отправить пример через «Поделиться».' : '');
  return true;
 } catch (e) { draftStatus('Черновик не сохранён: ' + e.message,true); return false; }
}
function clearCaptureDraft() {
 try {
  const state = captureEnvelope(); state.draft = null; writeCaptureEnvelope(state); draftStatus(''); return true;
 } catch (e) { draftStatus('Не удалось очистить черновик: ' + e.message,true); return false; }
}
function updateDraftResume(state) {
 try {
  state = state || captureEnvelope();
  $('resumeDraftPanel').classList.toggle('hidden',!state.draft);
  $('resumeDraftLabel').textContent = state.draft ? (state.draft.fields.word || 'Новая карточка') : '';
 } catch (_) { /* A storage error must not prevent opening the library. */ }
}
function restoreEditorDraft() {
 const state = captureEnvelope(), draft = state.draft;
 if (!draft) return false;
 editing = draft.editing && db.cards.some(c => c.id === draft.editing) ? draft.editing : null;
 fillDeckSelect();
 for (const [key,id] of Object.entries(CARD_FIELDS)) {
  if (key !== 'deck' || db.decks.includes(draft.fields.deck)) $(id).value = String(draft.fields[key] || '');
 }
 $('formTitle').textContent = editing ? 'Изменить карточку' : 'Новая карточка';
 $('optionalCardFields').open=!!(draft.fields.ipa||draft.fields.exampleRu);
 draftStatus('Черновик восстановлен.'); return true;
}
function resumeCardDraft() {
 try { restoreEditorDraft(); show('add'); }
 catch (e) { alert('Не удалось открыть черновик: ' + e.message); }
}
function openNewCard() {
 try {
  const draft = captureEnvelope().draft;
  if (draft && !draft.editing) { restoreEditorDraft(); show('add'); return; }
  if (draft && !confirm('Открыть новую карточку? Несохранённое редактирование текущей карточки будет отменено.')) return;
  resetForm(); show('add');
 } catch (e) { alert('Не удалось открыть карточку: ' + e.message); }
}
function canOpenCardEdit(id) {
 try {
  const draft = captureEnvelope().draft;
  return !draft || draft.editing === id || confirm('Открыть эту карточку? Текущий несохранённый черновик будет заменён.');
 } catch (e) { alert('Не удалось прочитать черновик: ' + e.message); return false; }
}
function initializeCapture() {
 const form = $('add');
 form.addEventListener('input',event => { if (Object.values(CARD_FIELDS).includes(event.target.id)) rememberCardDraft(); });
 form.addEventListener('change',event => { if (Object.values(CARD_FIELDS).includes(event.target.id)) rememberCardDraft(); });
 $('sharedTextDialog').addEventListener('cancel',event => { event.preventDefault(); dismissSharedText(); });
 try { restoreEditorDraft(); updateDraftResume(); }
 catch (e) { draftStatus('Не удалось восстановить черновик: ' + e.message,true); }
}
function retrySharedText(delay = 250) {
 if (shareRetryTimer) return;
 shareRetryTimer = setTimeout(() => { shareRetryTimer = null; receiveSharedTextFromNative(); },delay);
}
function acknowledgeSharedRequest(id) {
 try { return AndroidBridge.acknowledgeSharedText(id) === true; }
 catch (_) { return false; }
}
function receiveSharedTextFromNative() {
 if (!window.AndroidBridge || !AndroidBridge.peekSharedText || !ready || pendingSharedRequest) return;
 if (actionBusy || document.querySelector('dialog[open]')) { retrySharedText(); return; }
 try {
  const payload = JSON.parse(AndroidBridge.peekSharedText());
  if (!payload) return;
  if (typeof payload.id !== 'string' || typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 20000) throw new Error('Получен неподдерживаемый текст.');
  const state = captureEnvelope();
  if (state.receivedShares.includes(payload.id)) {
   retrySharedText(acknowledgeSharedRequest(payload.id) ? 0 : 1000); return;
  }
  pendingSharedRequest = payload;
  $('sharedTextPreview').textContent = payload.text;
  const fields = formFields();
  $('sharedTextContext').textContent = fields.word ? 'В карточку: ' + fields.word : 'В черновик новой карточки';
  $('sharedTextError').textContent = '';
  $('sharedTextDialog').showModal();
 } catch (e) { alert('Не удалось принять текст: ' + e.message); }
}
function finishSharedRequest() {
 const id = pendingSharedRequest.id;
 $('sharedTextDialog').close(); pendingSharedRequest = null;
 retrySharedText(acknowledgeSharedRequest(id) ? 0 : 1000);
}
function applySharedText(field) {
 if (!pendingSharedRequest || !['word','example'].includes(field)) return;
 const fields = formFields(), value = pendingSharedRequest.text;
 if (fields[field] && fields[field] !== value && !confirm('Поле «' + (field === 'word' ? 'Слово' : 'Пример') + '» уже заполнено. Заменить его полученным текстом?')) return;
 try {
  const state = captureEnvelope(); fields[field] = value;
  state.draft = {editing,fields};
  state.receivedShares = [...state.receivedShares,pendingSharedRequest.id].slice(-64);
  // Save first; a failed write leaves the old form and native inbox untouched.
  writeCaptureEnvelope(state);
  $(CARD_FIELDS[field]).value = value;
  finishSharedRequest(); show('add');
  draftStatus('Текст добавлен в черновик. Дополни карточку и нажми «Сохранить карточку».');
  $(CARD_FIELDS[field]).focus();
 } catch (e) { $('sharedTextError').textContent = 'Текст не добавлен: ' + e.message + '. Повтори попытку.'; }
}
function dismissSharedText() {
 if (!pendingSharedRequest) return;
 try {
  const state = captureEnvelope();
  state.receivedShares = [...state.receivedShares,pendingSharedRequest.id].slice(-64);
  writeCaptureEnvelope(state); finishSharedRequest();
 } catch (e) { $('sharedTextError').textContent = 'Не удалось закрыть: ' + e.message; }
}
