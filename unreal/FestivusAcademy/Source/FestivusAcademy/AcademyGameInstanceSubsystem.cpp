#include "AcademyGameInstanceSubsystem.h"

#include "FestivusAcademy.h"
#include "Dom/JsonObject.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/ConfigCacheIni.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
TArray<FString> ReadStringArray(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
{
    TArray<FString> Result;
    const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
    if (!Object.IsValid() || !Object->TryGetArrayField(Field, Values) || Values == nullptr)
    {
        return Result;
    }

    for (const TSharedPtr<FJsonValue>& Value : *Values)
    {
        FString Text;
        if (Value.IsValid() && Value->TryGetString(Text))
        {
            Result.Add(MoveTemp(Text));
        }
    }
    return Result;
}
}

void UAcademyGameInstanceSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);

    FString ConfiguredBaseUrl;
    if (GConfig && GConfig->GetString(TEXT("Academy"), TEXT("ApiBaseUrl"), ConfiguredBaseUrl, GGameIni))
    {
        ConfiguredBaseUrl.TrimStartAndEndInline();
        if (!ConfiguredBaseUrl.IsEmpty())
        {
            BaseUrl = MoveTemp(ConfiguredBaseUrl);
        }
    }
    while (BaseUrl.EndsWith(TEXT("/")))
    {
        BaseUrl.LeftChopInline(1);
    }

    RefreshCatalog();
}

void UAcademyGameInstanceSubsystem::RefreshCatalog()
{
    const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetVerb(TEXT("GET"));
    Request->SetURL(BaseUrl + TEXT("/api/academy/rooms"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->OnProcessRequestComplete().BindUObject(this, &UAcademyGameInstanceSubsystem::HandleCatalogResponse);

    if (!Request->ProcessRequest())
    {
        UE_LOG(LogFestivusAcademy, Error, TEXT("Could not start academy catalog request: %s"), *Request->GetURL());
        OnCatalogLoaded.Broadcast(false);
    }
}

FString UAcademyGameInstanceSubsystem::GetTeaserUrl() const
{
    return BaseUrl + TEXT("/");
}

FString UAcademyGameInstanceSubsystem::GetRoomUrl(const FString& RoomSlug) const
{
    return FString::Printf(TEXT("%s/academy/%s?unreal=1"), *BaseUrl, *RoomSlug);
}

void UAcademyGameInstanceSubsystem::HandleCatalogResponse(
    FHttpRequestPtr Request,
    FHttpResponsePtr Response,
    bool bConnectedSuccessfully)
{
    const bool bHttpOk = bConnectedSuccessfully && Response.IsValid() &&
        EHttpResponseCodes::IsOk(Response->GetResponseCode());
    const bool bParsed = bHttpOk && ParseCatalog(Response->GetContentAsString());

    if (!bParsed)
    {
        const int32 Status = Response.IsValid() ? Response->GetResponseCode() : 0;
        UE_LOG(LogFestivusAcademy, Warning,
            TEXT("Academy catalog unavailable (%d) from %s. The built-in room buttons remain usable."),
            Status,
            Request.IsValid() ? *Request->GetURL() : TEXT("unknown URL"));
    }

    OnCatalogLoaded.Broadcast(bParsed);
}

bool UAcademyGameInstanceSubsystem::ParseCatalog(const FString& Payload)
{
    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Payload);
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
    {
        return false;
    }

    const TArray<TSharedPtr<FJsonValue>>* RoomValues = nullptr;
    if (!Root->TryGetArrayField(TEXT("rooms"), RoomValues) || RoomValues == nullptr)
    {
        return false;
    }

    TArray<FAcademyRoomSummary> ParsedRooms;
    for (const TSharedPtr<FJsonValue>& Value : *RoomValues)
    {
        const TSharedPtr<FJsonObject> Object = Value.IsValid() ? Value->AsObject() : nullptr;
        if (!Object.IsValid())
        {
            continue;
        }

        FAcademyRoomSummary Room;
        Object->TryGetStringField(TEXT("slug"), Room.Slug);
        Object->TryGetStringField(TEXT("title"), Room.Title);
        Object->TryGetStringField(TEXT("shortTitle"), Room.ShortTitle);
        Object->TryGetStringField(TEXT("subtitle"), Room.Subtitle);
        Object->TryGetStringField(TEXT("status"), Room.Status);
        Object->TryGetStringField(TEXT("accent"), Room.Accent);

        double Number = 0.0;
        if (Object->TryGetNumberField(TEXT("order"), Number)) Room.Order = FMath::RoundToInt(Number);
        if (Object->TryGetNumberField(TEXT("estimatedMinutes"), Number)) Room.EstimatedMinutes = FMath::RoundToInt(Number);
        if (Object->TryGetNumberField(TEXT("missionCount"), Number)) Room.MissionCount = FMath::RoundToInt(Number);
        Room.LearningOutcomes = ReadStringArray(Object, TEXT("learningOutcomes"));

        if (!Room.Slug.IsEmpty() && !Room.Title.IsEmpty())
        {
            ParsedRooms.Add(MoveTemp(Room));
        }
    }

    ParsedRooms.Sort([](const FAcademyRoomSummary& Left, const FAcademyRoomSummary& Right)
    {
        return Left.Order < Right.Order;
    });
    Rooms = MoveTemp(ParsedRooms);
    return Rooms.Num() > 0;
}
