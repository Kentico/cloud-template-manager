import { Injectable } from '@angular/core';
import {
    AssetResponses,
    ContentItemResponses,
    IContentManagementClient,
    LanguageVariantModels,
    SharedContracts,
} from 'kentico-cloud-content-management';
import { FieldModels, FieldType } from 'kentico-cloud-delivery';
import { from, Observable, of } from 'rxjs';
import { delay, flatMap, map } from 'rxjs/operators';

import { observableHelper } from '../../../utilities';
import { BaseService } from '../../base-service';
import {
    IAssetFieldModel,
    ICMAssetModel,
    IContentItemFieldModel,
    IContentItemModel,
    IMultipleChoiceOptionModel,
    ISlimContentItemModel,
    IAssetModel,
} from '../../shared/shared.models';
import { IImportConfig, IImportContentItemsResult, IImportData, IAssetFromFile, IGetAssetData } from '../import.models';

interface ICreateContentItemResult {
    contentItem?: ISlimContentItemModel,
    languageVariant?: LanguageVariantModels.ContentItemLanguageVariant;
    assets?: ICMAssetModel[];
}
interface ICreateContentItemWithAssetsResult {
    contentItemResponse: ContentItemResponses.AddContentItemResponse;
    assetResponses: AssetResponses.AddAssetResponse[];
}

@Injectable()
export class ContentItemsImportService extends BaseService {

    constructor() {
        super();
    }

    importContentItems(data: IImportData, config: IImportConfig): Observable<IImportContentItemsResult> {
        const obs: Observable<void>[] = [];
        const importedContentItems: ISlimContentItemModel[] = [];
        const importedLanguageVariants: LanguageVariantModels.ContentItemLanguageVariant[] = [];
        const assets: ICMAssetModel[] = [];

        data.contentItems.forEach(contentItem => {
            obs.push(this.createContentItem(data.assetsFromFile, contentItem, data.targetClient, config).pipe(
                map((importResult) => {
                    if (!importResult.assets) {
                        throw Error(`Missing assets`);
                    }
                    if (!importResult.contentItem) {
                        throw Error(`Missing content item`);
                    }
                    if (!importResult.languageVariant) {
                        throw Error(`Missing language variant`);
                    }

                    importedContentItems.push(importResult.contentItem);
                    importedLanguageVariants.push(importResult.languageVariant);
                    assets.push(...importResult.assets);
                })
            ));
        });

        return observableHelper.zipObservables(obs).pipe(
            map(() => {
                return <IImportContentItemsResult>{
                    contentItems: importedContentItems,
                    languageVariants: importedLanguageVariants,
                    assets: assets
                }
            })
        );
    }


    private createContentItem(assetsFromFile: IAssetFromFile[], contentItem: IContentItemModel, targetClient: IContentManagementClient, config: IImportConfig): Observable<ICreateContentItemResult> {
        let result: ICreateContentItemResult = {
            assets: []
        };

        return targetClient.addContentItem()
            .withData({
                name: contentItem.system.name,
                type: {
                    codename: contentItem.system.type
                },
            })
            .toObservable()
            .pipe(
                delay(this.cmRequestDelay),
                flatMap(response => {
                    const createContentItemWithAssetsResult: ICreateContentItemWithAssetsResult = {
                        assetResponses: [],
                        contentItemResponse: response,
                    }
                    const obs: Observable<any>[] = [];
                    const elementKeys = Object.keys(contentItem.elements);
                    for (const elementCodename of elementKeys) {
                        const element = contentItem.elements[elementCodename];
                        if (element.type) {
                            if (element.type.toLowerCase() === FieldType.Asset.toLowerCase()) {
                                obs.push(...this.createAssets(assetsFromFile, contentItem, element as IAssetFieldModel, targetClient, config).map(
                                    m => m.pipe(map((assetResponse) => {
                                        createContentItemWithAssetsResult.assetResponses.push(assetResponse);
                                    })
                                    ))
                                )
                            };
                        }
                    }

                    if (obs.length === 0) {
                        return of(createContentItemWithAssetsResult)
                    }

                    return observableHelper.zipObservables(obs).pipe(map(() => {
                        if (!result.assets) {
                            throw Error(`Cannot assign assets`);
                        }
                        result.assets.push(...createContentItemWithAssetsResult.assetResponses.map(m => m.data));
                        return createContentItemWithAssetsResult;
                    }))

                }),
                flatMap((response) => {
                    const createdContentItem = response.contentItemResponse.data;
                    const assets = response.assetResponses.map(m => m.data);

                    config.processItem({
                        item: contentItem,
                        status: 'imported',
                        action: 'Add content item',
                        name: createdContentItem.codename
                    });

                    result.contentItem = {
                        codename: createdContentItem.codename,
                        externalId: createdContentItem.externalId,
                        id: createdContentItem.id,
                        name: createdContentItem.name,
                        sitemapLocations: createdContentItem.sitemapLocations,
                        type: createdContentItem.type,
                    };

                    if (!contentItem.system.language) {
                        throw Error(`Invalid language for item '${contentItem.system.language}'`);
                    }

                    return targetClient.upsertLanguageVariant()
                        .byItemCodename(createdContentItem.codename)
                        .byLanguageCodename(contentItem.system.language)
                        .withElementCodenames(this.getElements(contentItem, assets))
                        .toObservable();
                }),
                map(response => {
                    if (!result.contentItem) {
                        throw Error(`Content item was not assigned`);
                    }

                    config.processItem({
                        item: contentItem,
                        status: 'imported',
                        action: 'Add language variant',
                        name: `${result.contentItem.codename} [${contentItem.system.language}] | ${response.data.item.id}`
                    });

                    result.languageVariant = response.data;
                    return result;
                })
            );
    }

    private getAssetBlobFromUrl(asset: IAssetModel): Observable<IGetAssetData> {
        return from(new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', asset.url);
            xhr.responseType = 'blob';
            xhr.onload = () => {
                resolve({
                    blog: xhr.response,
                    asset: asset
                });
            }
            xhr.send();
        })) as Observable<IGetAssetData>;
    }

    private createAssets(assetsFromFile: IAssetFromFile[], contentItem: IContentItemModel, assetField: IAssetFieldModel, targetClient: IContentManagementClient, config: IImportConfig): Observable<AssetResponses.AddAssetResponse>[] {
        const obs: Observable<AssetResponses.AddAssetResponse>[] = [];
        const assetsToCreateObs: Observable<IGetAssetData>[] = [];

        if (assetsFromFile.length > 0) {
            // create assets only from file
            const assetsForContentItem = assetsFromFile.filter(m => m.embeddedAsset.contentItemCodename === contentItem.system.codename);
            for (const assetFromFile of assetsForContentItem) {

                assetsToCreateObs.push(of(<IGetAssetData>{
                    asset: assetFromFile.embeddedAsset.asset,
                    blob: assetFromFile.data
                }));
            }

        } else {
            // create assets from urls from projects directly
            for (const asset of assetField.value) {    
                assetsToCreateObs.push(this.getAssetBlobFromUrl(asset));
            }
        }
            
            for (const assetObs of assetsToCreateObs) {
                obs.push(
                    assetObs.pipe(
                        flatMap(data => {
                            const asset: FieldModels.AssetModel = data.asset;
                            const contentLength = data.blob.size;
                            const contentType = data.asset.type;
                            const fileBinary = data.blob;
    
                            return targetClient.uploadBinaryFile()
                                .withData({
                                    binaryData: fileBinary,
                                    contentLength: contentLength,
                                    contentType: contentType,
                                    filename: asset.name
                                }).toObservable().pipe(
                                    flatMap(response => {
    
                                        config.processItem({
                                            item: contentItem,
                                            status: 'imported',
                                            action: 'Upload binary file',
                                            name: `[${response.data.type}] - ${response.data.id}`
                                        });
    
                                        return targetClient.addAsset().withData({
                                            title: asset.name,
                                            descriptions: [{
                                                description: asset.description,
                                                language: {
                                                    codename: contentItem.system.language
                                                }
                                            }],
                                            fileReference: {
                                                id: response.data.id,
                                                type: response.data.type
                                            },
                                            externalId: asset.url,
                                        }).toObservable()
                                    }),
                                    map((response) => {
                                        config.processItem({
                                            item: contentItem,
                                            status: 'imported',
                                            action: 'Add asset',
                                            name: `[${response.data.type}] - ${response.data.id}`
                                        });
                                        return response;
                                    })
                                )
                        }
                        )
                    ))
            }

        return obs;
    }

    private mapElementValue(field: IContentItemFieldModel, assets: ICMAssetModel[]): any {
        if (field.type.toLowerCase() === FieldType.ModularContent.toLowerCase()) {
            const linkedItems = field.value as string[];
            return linkedItems.map(m => <SharedContracts.IReferenceObjectContract>{
                codename: m
            });
        }

        const value = field.value;

        if (field.type.toLowerCase() === FieldType.MultipleChoice.toLowerCase()) {
            const multipleChoiceField = field.value as IMultipleChoiceOptionModel[];

            return multipleChoiceField.map(option => <SharedContracts.IReferenceObjectContract>{
                codename: option.codename
            });
        }

        if (field.type.toLowerCase() === FieldType.Asset.toLowerCase()) {
            const assetIds: SharedContracts.IReferenceObjectContract[] = [];
            const assetField = field as IAssetFieldModel;

            for (const asset of assetField.value) {
                const newAssetId = assets.find(m => m.externalId === asset.url);

                if (newAssetId) {
                    assetIds.push({
                        id: newAssetId.id
                    });
                }
            }
            return assetIds;
        }

        return value;
    }

    private getElements(contentItem: IContentItemModel, assets: ICMAssetModel[]): LanguageVariantModels.ILanguageVariantElementCodename[] {
        const elements: LanguageVariantModels.ILanguageVariantElementCodename[] = [];

        const elementCodenames = Object.keys(contentItem.elements);

        for (const elementCodename of elementCodenames) {
            elements.push({
                codename: elementCodename,
                value: this.mapElementValue(contentItem.elements[elementCodename], assets)
            });
        }

        return elements;
    }


}