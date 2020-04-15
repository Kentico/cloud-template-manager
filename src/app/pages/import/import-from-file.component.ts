import { ChangeDetectionStrategy, ChangeDetectorRef, Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { NgxFileDropEntry } from 'ngx-file-drop';

import { ComponentDependencies } from '../../../di';
import { environment } from '../../../environments/environment';
import { BasePageComponent } from '../../core/base-page.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-from-file.component.html',
})
export class ImportFromFileComponent extends BasePageComponent {

  public formGroup: FormGroup;
  public error?: string;
  public file?: File;

  constructor(
    dependencies: ComponentDependencies,
    cdr: ChangeDetectorRef,
    private fb: FormBuilder) {
    super(dependencies, cdr);

    this.formGroup = this.fb.group({
      projectId: [environment.defaultProjects.targetProjectId, Validators.required],
      cmApiKey: [environment.defaultProjects.targetProjectApiKey, Validators.required],
      publishAllItems: [true],
    });

    // init stored values
      const storedData = dependencies.importDataStorageService.getImportData();
      if (storedData) {
        this.formGroup.controls['projectId'].setValue(storedData.targetProjectId);
        this.formGroup.controls['cmApiKey'].setValue(storedData.targetProjectApiKey);
        this.formGroup.controls['publishAllItems'].setValue(storedData.publishContentItems);
      }
  }

  ngOnInit(): void {
    super.setTitle('Import data');
  }

  handlePreview(): void {
      // track gEvent
      super.trackEvent({
        eventCategory: 'button',
        eventAction: 'prepare-import-from-file',
      });

      this.resetErrors();
      super.startLoading();
  }

  handleManualInputOnChange(change: Event): void {
    this.file = undefined;
    if (change.target) {
      const fileList = (change.target as any)['files'] as FileList;

      if (fileList.length > 0) {
        this.file = fileList[0];
      }
      super.detectChanges();
    }
  }

  handleImport(): void {
    
  }

  dropped(event: NgxFileDropEntry) {

  }


  private resetErrors(): void {
    this.error = undefined;
  }
}
