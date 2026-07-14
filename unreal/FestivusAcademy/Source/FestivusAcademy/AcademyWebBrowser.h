#pragma once

#include "CoreMinimal.h"
#include "WebBrowser.h"
#include "AcademyWebBrowser.generated.h"

class UAcademyBrowserBridge;

/** UWebBrowser with one deliberately tiny JavaScript-to-native bridge. */
UCLASS()
class FESTIVUSACADEMY_API UAcademyWebBrowser : public UWebBrowser
{
    GENERATED_BODY()

public:
    void SetAcademyBridge(UAcademyBrowserBridge* InBridge);
    void ShutdownBrowser();

protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void ReleaseSlateResources(bool bReleaseChildren) override;

private:
    void BindBridge();
    void UnbindBridge();

    UPROPERTY(Transient)
    TObjectPtr<UAcademyBrowserBridge> AcademyBridge;
};
