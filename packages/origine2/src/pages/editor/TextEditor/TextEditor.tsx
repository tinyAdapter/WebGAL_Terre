import * as monaco from 'monaco-editor';
import Editor, { loader, Monaco } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import styles from './textEditor.module.scss';
import { useSelector } from 'react-redux';
import { RootState } from '../../../store/origineStore';
import axios from 'axios';
import { logger } from '../../../utils/logger';

// 语法高亮相关的依赖
import { loadWASM } from 'onigasm'; // peer dependency of 'monaco-textmate'
import { Registry } from 'monaco-textmate'; // peer dependency
import { wireTmGrammars } from 'monaco-editor-textmate';
// 语法高亮文件
import hljson from '../../../config/highlighting/hl.json';
import theme from '../../../config/themes/monokai-light.json';
import { editorLineHolder, lspSceneName, WG_ORIGINE_RUNTIME } from '../../../runtime/WG_ORIGINE_RUNTIME';
import { WsUtil } from '../../../utils/wsUtil';
import { eventBus } from '@/utils/eventBus';
import _ from 'lodash';

interface ITextEditorProps {
  targetPath: string;
  isHide: boolean;
}

let isAfterMount = false;

const makeNoEmptyLineMarker = (lineNumber: number): monaco.editor.IMarkerData => ({
  severity: monaco.MarkerSeverity.Warning,
  startLineNumber: lineNumber,
  startColumn: 0,
  endLineNumber: lineNumber,
  endColumn: 2,
  message: 'WGSP001: 空行无法得到预期结果。如需进行脚本分段，请添加`;`。',
  code: 'no-empty-line',
});

const isDeletingLine = (ev: monaco.editor.IModelContentChangedEvent) =>
  ev.changes[0].range.startLineNumber !== ev.changes[0].range.endLineNumber;

export default function TextEditor(props: ITextEditorProps) {
  const target = useSelector((state: RootState) => state.status.editor.selectedTagTarget);
  const tags = useSelector((state: RootState) => state.status.editor.tags);
  const currentEditingGame = useSelector((state: RootState) => state.status.editor.currentEditingGame);
  // const currentText = useValue<string>("Loading Scene Data......");
  const currentText = { value: 'Loading Scene Data......' };
  const sceneName = tags.find((e) => e.tagTarget === target)!.tagName;
  const isAutoWarp = useSelector((state: RootState) => state.userData.isWarp);

  let [allMarkers, setAllMarkers] = useState<monaco.editor.IMarkerData[]>([]);

  // 准备获取 Monaco
  // 建立 Ref
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  loader.config({ monaco });

  /**
   * 处理挂载事件
   * @param {any} editor
   * @param {any} monaco
   */
  function handleEditorDidMount(editor: monaco.editor.IStandaloneCodeEditor, monaco: Monaco) {
    logger.debug('脚本编辑器挂载');
    lspSceneName.value = sceneName;
    editorRef.current = editor;
    editor.onDidChangeCursorPosition((event) => {
      const lineNumber = event.position.lineNumber;
      const editorValue = editor.getValue();
      const targetValue = editorValue.split('\n')[lineNumber - 1];
      // const trueLineNumber = getTrueLinenumber(lineNumber, editorRef.current?.getValue()??'');
      const sceneName = tags.find((e) => e.tagTarget === target)!.tagName;
      if (!isAfterMount) {
        editorLineHolder.recordSceneEdittingLine(props.targetPath, lineNumber);
      }
      WsUtil.sendSyncCommand(sceneName, lineNumber, targetValue);
    });
    editor.updateOptions({ unicodeHighlight: { ambiguousCharacters: false }, wordWrap: isAutoWarp ? 'on' : 'off' });
    liftOff(editor).then();
    isAfterMount = true;
    updateEditData();
  }

  useEffect(() => {
    editorRef?.current?.updateOptions?.({ wordWrap: isAutoWarp ? 'on' : 'off' });
  }, [isAutoWarp]);

  /**
   * handle monaco change
   * @param {string} value
   * @param {any} ev
   */
  function handleChange(value: string | undefined, ev: monaco.editor.IModelContentChangedEvent) {
    logger.debug('编辑器提交更新');
    const lineNumber = ev.changes[0].range.startLineNumber;
    if (!isAfterMount) {
      editorLineHolder.recordSceneEdittingLine(props.targetPath, lineNumber);
    }

    // const trueLineNumber = getTrueLinenumber(lineNumber, value ?? "");
    const gameName = currentEditingGame;
    if (value) currentText.value = value;
    const params = new URLSearchParams();
    params.append('gameName', gameName);
    params.append('sceneName', sceneName);
    params.append('sceneData', JSON.stringify({ value: currentText.value }));
    eventBus.emit('update-scene', currentText.value);
    axios.post('/api/manageGame/editScene/', params).then((res) => {
      const targetValue = currentText.value.split('\n')[lineNumber - 1];
      WsUtil.sendSyncCommand(sceneName, lineNumber, targetValue);
    });

    const currentTextLines = currentText.value.split(/\r?\n/g);
    const contextLineNumberStart = Math.max(isDeletingLine(ev) ? lineNumber - 2 : lineNumber - 1, 0);
    const contextLineNumberEnd = Math.min(contextLineNumberStart + 2, currentTextLines.length - 1);
    const contextLineNumbers = _.range(contextLineNumberStart, contextLineNumberEnd + 1);
    validate(
      contextLineNumbers,
      currentTextLines.slice(contextLineNumberStart, contextLineNumberEnd + 1),
      currentTextLines.length,
    );
  }

  function validate(lineNumbers: number[], context: string[], numLines: number) {
    if (lineNumbers.length !== context.length) {
      console.error(`lineNumbers.length !== context.length: ${lineNumbers.length} !== ${context.length}`);
      return;
    }

    let newMarkers = allMarkers.filter(
      (m) => !lineNumbers.includes(m.startLineNumber - 1) && !(m.endLineNumber >= numLines),
    );
    for (var i = 0; i < context.length; i++) {
      if (context[i] === '') {
        newMarkers.push(makeNoEmptyLineMarker(lineNumbers[i] + 1));
      }
    }

    setAllMarkers([...newMarkers]);

    const model = editorRef.current?.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, 'webgal', newMarkers);
    }
  }

  function updateEditData() {
    const currentEditName = tags.find((e) => e.tagTarget === target)!.tagName;
    const url = `/games/${currentEditingGame}/game/scene/${currentEditName}`;
    axios
      .get(url)
      .then((res) => res.data)
      .then((data) => {
        // currentText.set(data);
        currentText.value = data.toString();
        eventBus.emit('update-scene', data.toString());
        editorRef.current?.getModel()?.setValue(currentText.value);
        if (isAfterMount) {
          const targetLine = editorLineHolder.getSceneLine(props.targetPath);
          editorRef?.current?.setPosition({ lineNumber: targetLine, column: 0 });
          editorRef?.current?.revealLineInCenter(targetLine, 0);
          isAfterMount = false;
        }

        const currentTextLines = currentText.value.split(/\r?\n/g);
        validate(_.range(0, currentTextLines.length), currentTextLines, currentTextLines.length);
      });
  }

  return (
    <div style={{ display: props.isHide ? 'none' : 'block' }} className={styles.textEditor_main}>
      <Editor
        height="100%"
        width="100%"
        onMount={handleEditorDidMount}
        onChange={handleChange}
        defaultLanguage="webgal"
        language="webgal"
        defaultValue={currentText.value}
      />
    </div>
  );
}

async function liftOff(editor: monaco.editor.IStandaloneCodeEditor) {
  if (!WG_ORIGINE_RUNTIME.textEditor.isInitWasm) {
    await loadWASM(`./wasm/onigasm.wasm`); // See https://www.npmjs.com/package/onigasm#light-it-up
    WG_ORIGINE_RUNTIME.textEditor.isInitWasm = true;
  }

  const registry = new Registry({
    getGrammarDefinition: async (scopeName) => {
      return {
        format: 'json',
        content: JSON.stringify(hljson),
      };
    },
  });

  // map of monaco "language id's" to TextMate scopeNames
  const grammars = new Map();
  grammars.set('webgal', 'source.txt');

  // monaco's built-in themes aren't powereful enough to handle TM tokens
  // https://github.com/Nishkalkashyap/monaco-vscode-textmate-theme-converter#monaco-vscode-textmate-theme-converter
  monaco.editor.defineTheme('webgal-theme', theme as any);
  editor.updateOptions({ theme: 'webgal-theme' });

  await wireTmGrammars(monaco, registry, grammars, editor);
}

/**
 * 现在不用搞这一套换算了
 */

// function getTrueLinenumber(lineNumber: number, allText: string) {
//   // CRLF 转 LF
//   const text = allText.replaceAll(/\r\n/g, "\n");
//   const textArray = text.split("\n");
//   const trueLineNumber = [0];
//   for (let i = 1; i <= textArray.length; i++) {
//     const line = textArray[i - 1];
//     // 取分号前
//     const lineContent = line.split(";")[0];
//     if (lineContent !== "") {
//       trueLineNumber[i] = trueLineNumber[i - 1] + 1;
//     } else trueLineNumber[i] = trueLineNumber[i - 1];
//   }
//   return trueLineNumber[lineNumber];
// }
