#pragma once

#include "CoreMinimal.h"
#include "Interfaces/IHttpRequest.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "AcademyTypes.h"
#include "AcademyGameInstanceSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnAcademyCatalogLoaded, bool, bSucceeded);

/**
 * Long-lived bridge between Unreal and the web curriculum. The academy shell
 * intentionally fetches room manifests over HTTP so curriculum can ship on
 * Vercel without rebuilding or redistributing the Unreal client.
 */
UCLASS()
class FESTIVUSACADEMY_API UAcademyGameInstanceSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;

    UFUNCTION(BlueprintCallable, Category = "Academy")
    void RefreshCatalog();

    UFUNCTION(BlueprintPure, Category = "Academy")
    const TArray<FAcademyRoomSummary>& GetRooms() const { return Rooms; }

    UFUNCTION(BlueprintPure, Category = "Academy")
    FString GetBaseUrl() const { return BaseUrl; }

    UFUNCTION(BlueprintPure, Category = "Academy")
    FString GetTeaserUrl() const;

    UFUNCTION(BlueprintPure, Category = "Academy")
    FString GetRoomUrl(const FString& RoomSlug) const;

    UPROPERTY(BlueprintAssignable, Category = "Academy")
    FOnAcademyCatalogLoaded OnCatalogLoaded;

private:
    void HandleCatalogResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bConnectedSuccessfully);
    bool ParseCatalog(const FString& Payload);

    UPROPERTY()
    TArray<FAcademyRoomSummary> Rooms;

    FString BaseUrl = TEXT("http://localhost:3000");
};
