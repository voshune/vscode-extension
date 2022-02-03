import * as vscode from 'vscode';
import { SNYK_OPEN_BROWSER_COMMAND } from '../../../common/constants/commands';
import { SNYK_VIEW_FALSE_POSITIVE_CODE } from '../../../common/constants/views';
import { ErrorHandler } from '../../../common/error/errorHandler';
import { ILog } from '../../../common/logger/interfaces';
import { getNonce } from '../../../common/views/nonce';
import { WebviewPanelSerializer } from '../../../common/views/webviewPanelSerializer';
import { WebviewProvider } from '../../../common/views/webviewProvider';
import { ExtensionContext } from '../../../common/vscode/extensionContext';
import { IVSCodeWindow } from '../../../common/vscode/window';
import { IVSCodeWorkspace } from '../../../common/vscode/workspace';
import { messages as errorMessages } from '../../messages/error';

enum FalsePositiveViewEventMessageType {
  OpenBrowser = 'openBrowser',
  Close = 'close',
}

type FalsePositiveViewEventMessage = {
  type: FalsePositiveViewEventMessageType;
  value: unknown;
};

export type FalsePositiveWebviewModel = {
  title: string;
  severity: string;
  suggestionType: 'Issue' | 'Vulnerability';
  cwe: string[];
  content: string;
};

export class FalsePositiveWebviewProvider extends WebviewProvider<FalsePositiveWebviewModel> {
  constructor(
    private readonly workspace: IVSCodeWorkspace,
    protected readonly context: ExtensionContext,
    private readonly window: IVSCodeWindow,
    protected readonly logger: ILog,
  ) {
    super(context, logger);
  }

  activate(): void {
    this.context.addDisposables(
      this.window.registerWebviewPanelSerializer(SNYK_VIEW_FALSE_POSITIVE_CODE, new WebviewPanelSerializer(this)),
    );
  }

  async showPanel(model: FalsePositiveWebviewModel): Promise<void> {
    try {
      if (this.panel) {
        this.panel.reveal(vscode.ViewColumn.One, true);
      } else {
        this.panel = vscode.window.createWebviewPanel(
          SNYK_VIEW_FALSE_POSITIVE_CODE,
          'Snyk Report False Positive',
          {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: true,
          },
          {
            enableScripts: true,
            localResourceRoots: [this.context.getExtensionUri()],
          },
        );
      }

      this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);

      await this.panel.webview.postMessage({ type: 'set', args: model });

      this.registerListeners();
    } catch (e) {
      ErrorHandler.handle(e, this.logger, errorMessages.reportFalsePositiveViewShowFailed);
    }
  }

  private registerListeners() {
    if (!this.panel) return;

    this.panel.onDidDispose(this.onPanelDispose.bind(this), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (data: FalsePositiveViewEventMessage) => {
        switch (data.type) {
          case FalsePositiveViewEventMessageType.OpenBrowser:
            void vscode.commands.executeCommand(SNYK_OPEN_BROWSER_COMMAND, data.value);
            break;
          case FalsePositiveViewEventMessageType.Close:
            this.disposePanel();
            break;
          default:
            break;
        }
      },
      null,
      this.disposables,
    );
    this.panel.onDidChangeViewState(this.checkVisibility.bind(this), null, this.disposables);
  }

  protected getHtmlForWebview(webview: vscode.Webview): string {
    const images: Record<string, string> = [
      ['dark-critical-severity', 'svg'],
      ['dark-high-severity', 'svg'],
      ['dark-medium-severity', 'svg'],
      ['dark-low-severity', 'svg'],
      ['warning', 'svg'],
    ].reduce((accumulator: Record<string, string>, [name, ext]) => {
      const uri = this.getWebViewUri('media', 'images', `${name}.${ext}`);
      if (!uri) throw new Error('Image missing.');
      accumulator[name] = uri.toString();
      return accumulator;
    }, {});

    const scriptUri = this.getWebViewUri(
      'out',
      'snyk',
      'snykCode',
      'views',
      'falsePositive',
      'falsePositiveWebviewScript.js',
    );
    const styleUri = this.getWebViewUri('media', 'views', 'snykCode', 'falsePositive', 'falsePositive.css');

    const nonce = getNonce();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">

				<link href="${styleUri}" rel="stylesheet">
			</head>
			<body>
        <div class="suggestion">
          <section>
            <div class="severity">
              <img id="lowl" class="icon light-only hidden" src="${images['dark-low-severity']}" />
              <img id="lowd" class="icon dark-only hidden" src="${images['dark-low-severity']}" />
              <img id="mediuml" class="icon light-only hidden" src="${images['dark-medium-severity']}" />
              <img id="mediumd" class="icon dark-only hidden" src="${images['dark-medium-severity']}" />
              <img id="highl" class="icon light-only hidden" src="${images['dark-high-severity']}" />
              <img id="highd" class="icon dark-only hidden" src="${images['dark-high-severity']}" />
              <img id="criticall" class="icon light-only hidden" src="${images['dark-critical-severity']}" />
              <img id="criticald" class="icon dark-only hidden" src="${images['dark-critical-severity']}" />
              <span id="severity-text"></span>
            </div>
            <div class="suggestion-text"></div>
            <div class="identifiers"></div>
          </section>
          <section class="delimiter-top editor-section">
            <textarea class="editor"></textarea>
          </section>
          <section class="delimiter-top">
          <div class="warning">
            <img src="${images['warning']}" />
            <span>Please check the code. It will be uploaded to Snyk and manually reviewed by our engineers.</span>
          </div>
          </section>
          <section class="delimiter-top">
          <div class="actions">
            <button id="report" class="button">Send code</button>
            <button id="cancel" class="button secondary">Cancel <span id="line-position2"></span></button>
          </div>
        </div>
          </section>
        </div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
  }
}